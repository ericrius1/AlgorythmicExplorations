"""Bit-exact PyTorch mirror of Small Minds' pure-WebGPU micro-Transformer + SMW1 codec.

Matches:
  - src/lib/llm/tokenizer.ts      (98-token printable ASCII + control CharTokenizer)
  - src/lib/llm/webgpuEngine.ts   (parameter order, RMSNorm eps=1e-5, untied embed/head)
  - src/lib/llm/shaders/ops.wgsl  (interleaved-pair RoPE, SwiGLU / tanh-approx GeGLU)
  - src/lib/llm/checkpoint.ts     (SMW1 binary header + group-wise Q8 / FP32 payload)
"""

from __future__ import annotations

import json
import math
import struct
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

BOS_ID = 0
EOS_ID = 1
NL_ID = 2
FIRST_PRINTABLE = 3
VOCAB_SIZE = 98
MAGIC = b"SMW1"


def encode_text(text: str, add_bos: bool = False) -> np.ndarray:
    out: list[int] = [BOS_ID] if add_bos else []
    for ch in text:
        code = ord(ch)
        if code == 10:
            out.append(NL_ID)
        elif 32 <= code <= 126:
            out.append(FIRST_PRINTABLE + (code - 32))
        elif code == 9:
            out.append(FIRST_PRINTABLE)
        elif code in (8216, 8217):
            out.append(FIRST_PRINTABLE + (39 - 32))
        elif code in (8220, 8221):
            out.append(FIRST_PRINTABLE + (34 - 32))
        elif code in (8211, 8212):
            out.append(FIRST_PRINTABLE + (45 - 32))
    return np.asarray(out, dtype=np.int64)


def decode_tokens(ids: list[int] | np.ndarray | torch.Tensor) -> str:
    if isinstance(ids, torch.Tensor):
        ids = ids.detach().cpu().tolist()
    chars: list[str] = []
    for i in ids:
        idx = int(i)
        if idx in (BOS_ID, EOS_ID):
            continue
        if idx == NL_ID:
            chars.append("\n")
        elif FIRST_PRINTABLE <= idx < VOCAB_SIZE:
            chars.append(chr(32 + (idx - FIRST_PRINTABLE)))
    return "".join(chars)


@dataclass
class SmallMindsConfig:
    vocabSize: int = VOCAB_SIZE
    seqLen: int = 128
    dModel: int = 128
    nLayers: int = 4
    nHeads: int = 4
    ffnDim: int = 320
    activation: Literal["swiglu", "gelu"] = "swiglu"
    optimizer: Literal["adamw", "muon"] = "adamw"
    lr: float = 0.0008
    weightDecay: float = 0.01
    ropeTheta: float = 10000.0
    batchSize: int = 4

    def validate(self) -> None:
        assert self.vocabSize == VOCAB_SIZE, f"vocabSize must be {VOCAB_SIZE}"
        assert self.dModel % self.nHeads == 0, "dModel must be divisible by nHeads"
        hd = self.dModel // self.nHeads
        assert hd <= 32 and hd % 2 == 0, (
            f"WebGPU FlashAttention requires even headDim <= 32 (got {hd})"
        )

    def param_count(self) -> int:
        v, d, l, f = self.vocabSize, self.dModel, self.nLayers, self.ffnDim
        per_layer = d + 4 * d * d + d + 2 * f * d + d * f
        return v * d + l * per_layer + d + v * d


class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-5):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        xf = x.float()
        inv = torch.rsqrt(xf.pow(2).mean(dim=-1, keepdim=True) + self.eps)
        return (xf * inv).to(x.dtype) * self.weight


def precompute_rope(seq_len: int, head_dim: int, theta: float, device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
    pairs = torch.arange(0, head_dim // 2, device=device, dtype=torch.float32)
    freqs = theta ** (-2.0 * pairs / head_dim)
    positions = torch.arange(seq_len, device=device, dtype=torch.float32)
    angles = positions[:, None] * freqs[None, :]
    return torch.cos(angles)[None, :, None, :], torch.sin(angles)[None, :, None, :]


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    # Interleaved adjacent pairs (2p, 2p+1) — exact match with ops.wgsl:rope_apply
    xf = x.float()
    x0 = xf[..., 0::2]
    x1 = xf[..., 1::2]
    out0 = x0 * cos - x1 * sin
    out1 = x0 * sin + x1 * cos
    return torch.stack((out0, out1), dim=-1).flatten(-2).to(x.dtype)


class TransformerBlock(nn.Module):
    def __init__(self, cfg: SmallMindsConfig):
        super().__init__()
        d, f = cfg.dModel, cfg.ffnDim
        self.n_heads = cfg.nHeads
        self.head_dim = d // cfg.nHeads
        self.activation = cfg.activation

        self.rms1 = RMSNorm(d)
        self.wq = nn.Linear(d, d, bias=False)
        self.wk = nn.Linear(d, d, bias=False)
        self.wv = nn.Linear(d, d, bias=False)
        self.wo = nn.Linear(d, d, bias=False)

        self.rms2 = RMSNorm(d)
        self.w1 = nn.Linear(d, f, bias=False)  # gate
        self.w3 = nn.Linear(d, f, bias=False)  # up
        self.w2 = nn.Linear(f, d, bias=False)  # down

    def forward(self, x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
        b, t, d = x.shape
        h = self.rms1(x)
        q = self.wq(h).view(b, t, self.n_heads, self.head_dim)
        k = self.wk(h).view(b, t, self.n_heads, self.head_dim)
        v = self.wv(h).view(b, t, self.n_heads, self.head_dim)

        q = apply_rope(q, cos[:, :t], sin[:, :t]).transpose(1, 2)
        k = apply_rope(k, cos[:, :t], sin[:, :t]).transpose(1, 2)
        v = v.transpose(1, 2)

        y = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        y = y.transpose(1, 2).contiguous().view(b, t, d)
        x = x + self.wo(y)

        h2 = self.rms2(x)
        gate = self.w1(h2)
        up = self.w3(h2)
        if self.activation == "swiglu":
            act = F.silu(gate) * up
        else:
            act = F.gelu(gate, approximate="tanh") * up
        return x + self.w2(act)


class SmallMindsTransformer(nn.Module):
    def __init__(self, cfg: SmallMindsConfig):
        super().__init__()
        cfg.validate()
        self.cfg = cfg
        self.w_embed = nn.Embedding(cfg.vocabSize, cfg.dModel)
        self.layers = nn.ModuleList([TransformerBlock(cfg) for _ in range(cfg.nLayers)])
        self.rms_final = RMSNorm(cfg.dModel)
        self.w_head = nn.Linear(cfg.dModel, cfg.vocabSize, bias=False)
        self._init_weights()

        cos, sin = precompute_rope(cfg.seqLen, cfg.dModel // cfg.nHeads, cfg.ropeTheta, torch.device("cpu"))
        self.register_buffer("rope_cos", cos, persistent=False)
        self.register_buffer("rope_sin", sin, persistent=False)

    def _init_weights(self) -> None:
        std = 1.0 / math.sqrt(self.cfg.dModel)
        res_std = std / math.sqrt(2.0 * self.cfg.nLayers)
        nn.init.normal_(self.w_embed.weight, std=0.04)
        for layer in self.layers:
            nn.init.ones_(layer.rms1.weight)
            nn.init.normal_(layer.wq.weight, std=std)
            nn.init.normal_(layer.wk.weight, std=std)
            nn.init.normal_(layer.wv.weight, std=std)
            nn.init.normal_(layer.wo.weight, std=res_std)
            nn.init.ones_(layer.rms2.weight)
            nn.init.normal_(layer.w1.weight, std=std)
            nn.init.normal_(layer.w3.weight, std=std)
            nn.init.normal_(layer.w2.weight, std=res_std)
        nn.init.ones_(self.rms_final.weight)
        nn.init.normal_(self.w_head.weight, std=std * 0.5)

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        x = self.w_embed(input_ids)
        for layer in self.layers:
            x = layer(x, self.rope_cos, self.rope_sin)
        return self.w_head(self.rms_final(x))

    def ordered_params(self) -> list[nn.Parameter]:
        params: list[nn.Parameter] = [self.w_embed.weight]
        for layer in self.layers:
            params.extend([
                layer.rms1.weight,
                layer.wq.weight,
                layer.wk.weight,
                layer.wv.weight,
                layer.wo.weight,
                layer.rms2.weight,
                layer.w1.weight,
                layer.w3.weight,
                layer.w2.weight,
            ])
        params.extend([self.rms_final.weight, self.w_head.weight])
        return params

    def export_flat_weights(self) -> np.ndarray:
        chunks = [p.detach().float().cpu().contiguous().view(-1).numpy() for p in self.ordered_params()]
        flat = np.concatenate(chunks).astype("<f4", copy=False)
        return np.clip(flat, -7.99, 7.99)

    @torch.no_grad()
    def load_flat_weights(self, flat: np.ndarray) -> None:
        arr = np.asarray(flat, dtype=np.float32)
        offset = 0
        for p in self.ordered_params():
            n = p.numel()
            p.copy_(torch.from_numpy(arr[offset : offset + n]).view_as(p).to(p.device, p.dtype))
            offset += n
        assert offset == arr.size, f"Weight size mismatch: consumed {offset}, got {arr.size}"

    @torch.no_grad()
    def generate(
        self,
        prompt: str,
        max_new_tokens: int = 110,
        temperature: float = 0.68,
        top_p: float = 0.9,
        stop_on_newline: bool = True,
    ) -> str:
        self.eval()
        device = self.w_embed.weight.device
        ctx = encode_text(prompt).tolist() or [BOS_ID]
        gen: list[int] = []
        for _ in range(max_new_tokens):
            window = ctx[-self.cfg.seqLen :]
            inp = torch.tensor([window], dtype=torch.long, device=device)
            logits = self(inp)[0, -1].float() / max(0.05, temperature)
            probs = torch.softmax(logits, dim=-1)
            sorted_probs, sorted_idx = torch.sort(probs, descending=True)
            cdf = torch.cumsum(sorted_probs, dim=-1)
            mask = cdf - sorted_probs > top_p
            sorted_probs[mask] = 0.0
            sorted_probs /= sorted_probs.sum().clamp_min(1e-12)
            pick = int(sorted_idx[torch.multinomial(sorted_probs, 1).item()].item())
            if stop_on_newline and pick in (NL_ID, EOS_ID):
                break
            ctx.append(pick)
            gen.append(pick)
        return decode_tokens(gen)


def save_smw(
    path: str | Path,
    model: SmallMindsTransformer,
    meta: dict[str, Any] | None = None,
    quant: Literal["q8", "fp32"] = "q8",
    group_size: int = 32,
) -> dict[str, Any]:
    flat = model.export_flat_weights()
    param_count = int(flat.size)
    assert param_count == model.cfg.param_count()

    header = {
        "version": 1,
        "quant": quant,
        "groupSize": group_size,
        "paramCount": param_count,
        "config": asdict(model.cfg),
        "meta": meta or {},
    }
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    data_offset = (8 + len(header_bytes) + 3) & ~3
    pad = b"\x00" * (data_offset - 8 - len(header_bytes))

    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if quant == "fp32":
        payload = flat.astype("<f4").tobytes()
        rmse = 0.0
    else:
        num_groups = math.ceil(param_count / group_size)
        padded_len = num_groups * group_size
        padded = np.zeros(padded_len, dtype=np.float32)
        padded[:param_count] = flat
        groups = padded.reshape(num_groups, group_size)
        scales = np.maximum(np.max(np.abs(groups), axis=1) / 127.0, 1e-8).astype("<f4")
        q = np.clip(np.rint(groups / scales[:, None]), -127, 127).astype(np.int8)
        deq = (q.astype(np.float32) * scales[:, None]).reshape(-1)[:param_count]
        rmse = float(np.sqrt(np.mean((flat - deq) ** 2)))
        payload = scales.tobytes() + q.reshape(-1)[:param_count].tobytes()

    blob = MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + pad + payload
    out_path.write_bytes(blob)
    return {"path": str(out_path), "bytes": len(blob), "param_count": param_count, "rmse": rmse}


def load_smw(path: str | Path) -> tuple[SmallMindsConfig, np.ndarray, dict[str, Any]]:
    raw = Path(path).read_bytes()
    assert raw[:4] == MAGIC, "Bad SMW1 magic"
    header_len = struct.unpack_from("<I", raw, 4)[0]
    header = json.loads(raw[8 : 8 + header_len].decode("utf-8"))
    cfg = SmallMindsConfig(**header["config"])
    param_count = int(header["paramCount"])
    data_offset = (8 + header_len + 3) & ~3

    if header["quant"] == "fp32":
        weights = np.frombuffer(raw, dtype="<f4", count=param_count, offset=data_offset).copy()
    else:
        gs = int(header.get("groupSize", 32))
        num_groups = math.ceil(param_count / gs)
        scales = np.frombuffer(raw, dtype="<f4", count=num_groups, offset=data_offset)
        q_offset = data_offset + num_groups * 4
        q = np.frombuffer(raw, dtype=np.int8, count=param_count, offset=q_offset)
        weights = np.empty(param_count, dtype=np.float32)
        for g in range(num_groups):
            s = g * gs
            e = min(param_count, s + gs)
            weights[s:e] = q[s:e].astype(np.float32) * scales[g]
    return cfg, weights, header.get("meta", {})
