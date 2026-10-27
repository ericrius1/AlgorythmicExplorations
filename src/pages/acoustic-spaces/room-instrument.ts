import "../../styles/music-play.css";
import { wirePage } from "../../core/wirePage";
import { mountSoundControl } from "../../lib/music/soundControl";
import { mountOneStone, mountRoomInstrument } from "../../demos/music/roomInstrument";

wirePage({
  instrument: (el) => mountRoomInstrument(el, { hero: true, controls: "share", syncUrl: true }),
  builder: (el) => mountRoomInstrument(el, { hero: true, controls: "full", syncUrl: true }),
  onestone: mountOneStone,
});

mountSoundControl();
