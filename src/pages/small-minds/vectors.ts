import { wirePage } from "../../core/wirePage";
import {
  mountVectorsHero,
  mountDotProductDemo,
  mountMatrixTransformDemo,
  mountNonlinearFoldDemo,
} from "../../demos/llm/vectorsDemos";

wirePage({
  hero: mountVectorsHero,
  "dot-product": mountDotProductDemo,
  "matrix-transform": mountMatrixTransformDemo,
  "nonlinear-fold": mountNonlinearFoldDemo,
});
