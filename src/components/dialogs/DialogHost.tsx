import { useUI } from '../../state/uiStore';
import { NewDocumentDialog, ImageSizeDialog, CanvasSizeDialog, ExportDialog, SaveAsDialog, ConfirmCloseDialog } from './DocumentDialogs';
import { FilterDialog, AdjustmentDialog, LayerStyleDialog, SelectionModifyDialog, GridSettingsDialog, NewGuideDialog, RenameLayerDialog, ConfirmRasterizeDialog, SmartFilterDialog, ShortcutsDialog, AboutDialog, RecoverDialog, ProjectsDialog } from './EditDialogs';
import { getDocState } from '../../state/documentStore';
import type { AdjustmentKind } from '../../types/document';

export function DialogHost() {
  const d = useUI((s) => s.dialog);
  if (!d) return null;
  const needsDoc = !['new-document', 'shortcuts', 'about', 'recover', 'projects', 'grid-settings', 'confirm-close'].includes(d.type);
  if (needsDoc && !getDocState()) { queueMicrotask(() => useUI.setState({ dialog: null })); return null; }
  switch (d.type) {
    case 'new-document': return <NewDocumentDialog />;
    case 'image-size': return <ImageSizeDialog />;
    case 'canvas-size': return <CanvasSizeDialog />;
    case 'export': return <ExportDialog />;
    case 'save-as': return <SaveAsDialog />;
    case 'confirm-close': return <ConfirmCloseDialog docId={d.docId} />;
    case 'filter': return <FilterDialog key={d.filter} id={d.filter} />;
    case 'adjustment': return <AdjustmentDialog key={d.kind} kind={d.kind as AdjustmentKind} />;
    case 'layer-style': return <LayerStyleDialog key={d.layerId} layerId={d.layerId} tab={d.tab} />;
    case 'selection-modify': return <SelectionModifyDialog op={d.op} />;
    case 'grid-settings': return <GridSettingsDialog />;
    case 'new-guide': return <NewGuideDialog />;
    case 'rename-layer': return <RenameLayerDialog layerId={d.layerId} />;
    case 'smart-filter': return <SmartFilterDialog key={`${d.layerId}-${d.filter ?? d.kind}-${d.index ?? 'new'}`} layerId={d.layerId} filter={d.filter} kind={d.kind} index={d.index} />;
    case 'confirm-rasterize': return <ConfirmRasterizeDialog layerId={d.layerId} next={d.next} />;
    case 'shortcuts': return <ShortcutsDialog />;
    case 'about': return <AboutDialog />;
    case 'recover': return <RecoverDialog />;
    case 'projects': return <ProjectsDialog />;
    default: return null;
  }
}
