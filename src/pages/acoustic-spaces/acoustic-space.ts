import "../../styles/music-play.css";
import { wirePage } from "../../core/wirePage";
import { mountSoundControl } from "../../lib/music/soundControl";
import { mountSpaceHero } from "../../demos/music/space/hero1";
import { mountImageSources } from "../../demos/music/space/images";
import { mountSabine } from "../../demos/music/space/sabine";
import { mountBands } from "../../demos/music/space/bands";
import { mountModes } from "../../demos/music/space/modes";
import { mountEars } from "../../demos/music/space/ears";
import { mountLucier } from "../../demos/music/space/lucier";

wirePage({
  hero: mountSpaceHero,
  images: mountImageSources,
  sabine: mountSabine,
  bands: mountBands,
  modes: mountModes,
  ears: mountEars,
  lucier: mountLucier,
});

mountSoundControl();
