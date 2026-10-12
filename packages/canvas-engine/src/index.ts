// TinyCanvas 畫布引擎（見 docs/SPEC.md 第 3、4 節與本套件 README）
import './render/draw';

export { BoardEditor, type ExportOptions } from './editor';
export { EditorModel, type SectionDeleteMode, type GeomPatch } from './model';
export { SceneStore, type StoreChange } from './store';
export type {
  Tool,
  EditorState,
  EngineOptions,
  EngineLabels,
  WireframeContent,
  EditingGeometry,
  EditingState,
  EditField,
  PendingSectionDelete,
  AlignKind,
} from './types';
export { DEFAULT_LABELS, ExportTooLargeError, ExportEmptyError } from './types';
export type { Rect } from './geometry';
export { DEFAULT_PALETTE, PALETTE_COLORS, DEFAULT_SHAPE_COLOR, FONT_FAMILY, BRAND, SELECTION_COLOR, defaultShapeSize, resolveStyle, fontString, type ResolvedStyle } from './style';
export { SHAPE_ICON_NAMES, loadAllIconNames, getIconPath, drawIcon } from './render/icons';
export {
  registerRenderer,
  getRenderer,
  drawObjects,
  LodBatch,
  isFar,
  type ObjectRenderer,
  type RenderContext,
} from './render/draw';
export { drawTextLayout, TextLayoutCache } from './render/text';
export { shapePath, shapeTextBox, roundRectPath, type PathSink } from './render/shapes';
export { layoutRichText, breakLines, monoFont, taskCheckboxRect, TEXT_METRICS, type Measurer, type TextLayout, type LayoutLine } from './text/layout';
export { taskAt } from './render/text';
export { taskItems, isTaskChecked } from './text/tasks';
export { CLIPBOARD_MIME, parsePayload, type ClipboardPayload } from './clipboard';
export { computeRoute, orthogonalPath, type Route } from './connectors/route';
