#!/bin/zsh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/build"
OUTPUT="$HERE/output"
OVERLAYS="$HERE/overlays/png"

mkdir -p "$BUILD" "$OUTPUT" "$OVERLAYS"

for name in intro grid scan flow outro; do
  sips -s format png "$HERE/overlays/$name.svg" --out "$OVERLAYS/$name.png" >/dev/null
done

encode_sequence() {
  local name="$1"
  ffmpeg -hide_banner -loglevel error -y \
    -framerate 15 -c:v mjpeg -i "$HERE/source/$name/%03d.png" \
    -vf "fps=30,scale=iw:ih:in_range=full:out_range=tv,format=yuv420p" \
    -c:v libx264 -preset slow -crf 14 \
    "$BUILD/$name.mp4"
}

encode_sequence hero
encode_sequence grid
encode_sequence scan
encode_sequence sph

ffmpeg -hide_banner -loglevel error -y \
  -i "$BUILD/hero.mp4" \
  -i "$BUILD/grid.mp4" \
  -i "$BUILD/scan.mp4" \
  -i "$BUILD/sph.mp4" \
  -loop 1 -framerate 30 -i "$OVERLAYS/intro.png" \
  -loop 1 -framerate 30 -i "$OVERLAYS/grid.png" \
  -loop 1 -framerate 30 -i "$OVERLAYS/scan.png" \
  -loop 1 -framerate 30 -i "$OVERLAYS/flow.png" \
  -loop 1 -framerate 30 -i "$OVERLAYS/outro.png" \
  -filter_complex "
    [0:v]trim=duration=2.6,setpts=PTS-STARTPTS,scale=1280:720,eq=contrast=1.06:saturation=1.18[hero];
    [1:v]trim=duration=2.25,setpts=PTS-STARTPTS,crop=900:620:190:50,scale=1280:882,crop=1280:720:0:75,eq=contrast=1.08:saturation=1.16[grid];
    [2:v]trim=duration=2.25,setpts=PTS-STARTPTS,crop=900:620:190:45,scale=1280:882,crop=1280:720:0:68,eq=contrast=1.08:saturation=1.16[scan];
    [3:v]trim=duration=3.8,setpts=PTS-STARTPTS,crop=900:620:190:45,scale=1280:882,crop=1280:720:0:70,eq=contrast=1.08:saturation=1.2[sph];

    [4:v]format=rgba,trim=duration=2.6,setpts=PTS-STARTPTS,fade=t=in:st=0.12:d=0.22:alpha=1,fade=t=out:st=2.18:d=0.22:alpha=1[intro-o];
    [5:v]format=rgba,trim=duration=2.25,setpts=PTS-STARTPTS,fade=t=in:st=0.12:d=0.2:alpha=1,fade=t=out:st=1.82:d=0.2:alpha=1[grid-o];
    [6:v]format=rgba,trim=duration=2.25,setpts=PTS-STARTPTS,fade=t=in:st=0.12:d=0.2:alpha=1,fade=t=out:st=1.82:d=0.2:alpha=1[scan-o];
    [7:v]format=rgba,trim=duration=3.8,setpts=PTS-STARTPTS,fade=t=in:st=0.12:d=0.2:alpha=1,fade=t=out:st=1.22:d=0.22:alpha=1[flow-o];
    [8:v]format=rgba,trim=duration=3.8,setpts=PTS-STARTPTS,fade=t=in:st=1.62:d=0.25:alpha=1,fade=t=out:st=3.68:d=0.12:alpha=1[outro-o];

    [hero][intro-o]overlay=0:0:shortest=1[hero-t];
    [grid][grid-o]overlay=0:0:shortest=1[grid-t];
    [scan][scan-o]overlay=0:0:shortest=1[scan-t];
    [sph][flow-o]overlay=0:0:shortest=1[sph-flow];
    [sph-flow][outro-o]overlay=0:0:shortest=1[sph-t];

    [hero-t][grid-t]xfade=transition=fade:duration=0.3:offset=2.3[v01];
    [v01][scan-t]xfade=transition=fade:duration=0.3:offset=4.25[v012];
    [v012][sph-t]xfade=transition=fade:duration=0.3:offset=6.2,scale=1280:720:in_range=full:out_range=tv,format=yuv420p[out]
  " \
  -map "[out]" \
  -an -r 30 -t 10 \
  -c:v libx264 -preset slow -crf 17 -profile:v high -level 4.1 \
  -pix_fmt yuv420p -movflags +faststart \
  "$OUTPUT/sorting-water-x.mp4"

ffprobe -v error \
  -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate \
  -of default=noprint_wrappers=1 \
  "$OUTPUT/sorting-water-x.mp4"
