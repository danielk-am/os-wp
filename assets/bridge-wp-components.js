/**
 * Bridge: re-export window.wp.components as the @wordpress/components
 * module. Used via the importmap so app code can do
 *   import { Button, Card, ... } from '@wordpress/components'
 * and get the same component instances WP admin uses everywhere else.
 */
const c = window.wp && window.wp.components;
if (!c) {
  console.error('[core-index] window.wp.components not available — wp-components script not enqueued?');
}

// Re-export everything available on window.wp.components. We list the
// commonly-used ones explicitly so destructured imports get autocomplete /
// linting via the consumer's tsconfig; anything else is reachable via the
// default export.
export const Button = c?.Button;
export const ButtonGroup = c?.ButtonGroup;
export const RangeControl = c?.RangeControl;
export const Card = c?.Card;
export const CardBody = c?.CardBody;
export const CardHeader = c?.CardHeader;
export const CardFooter = c?.CardFooter;
export const CardDivider = c?.CardDivider;
export const Panel = c?.Panel;
export const PanelBody = c?.PanelBody;
export const PanelRow = c?.PanelRow;
export const PanelHeader = c?.PanelHeader;
export const TextControl = c?.TextControl;
export const TextareaControl = c?.TextareaControl;
export const SearchControl = c?.SearchControl;
export const SelectControl = c?.SelectControl;
export const ComboboxControl = c?.ComboboxControl;
export const ToggleControl = c?.ToggleControl;
export const CheckboxControl = c?.CheckboxControl;
export const BaseControl = c?.BaseControl;
// FormTokenField is Gutenberg's tag/token input (the same control used for
// post tags) — used by the reminder editor for freeform tags.
export const FormTokenField = c?.FormTokenField;
export const Spinner = c?.Spinner;
export const Notice = c?.Notice;
export const Snackbar = c?.Snackbar;
export const SnackbarList = c?.SnackbarList;
export const Modal = c?.Modal;
export const Tooltip = c?.Tooltip;
export const Flex = c?.Flex;
export const FlexItem = c?.FlexItem;
export const FlexBlock = c?.FlexBlock;
export const HStack = c?.__experimentalHStack;
export const VStack = c?.__experimentalVStack;
export const Heading = c?.__experimentalHeading;
export const Text = c?.__experimentalText;
export const Icon = c?.Icon;
export const Dashicon = c?.Dashicon;
export const Placeholder = c?.Placeholder;
// Badge — WPDS status pill (intent: default | info | success | warning | error).
// Backs ci/ui Badge. May be undefined on older cores; callers fall back.
export const Badge = c?.Badge;
// ToggleGroupControl — WPDS segmented switcher (the Visual | Code | Diagram
// style). Still experimental in core; backs ci/ui SegmentedToggle, which falls
// back to its handrolled pill when these are undefined.
export const ToggleGroupControl = c?.__experimentalToggleGroupControl;
export const ToggleGroupControlOption = c?.__experimentalToggleGroupControlOption;
// Block toolbar primitives + color/dropdown — used by the Canvas node toolbar.
export const Toolbar = c?.Toolbar;
export const ToolbarGroup = c?.ToolbarGroup;
export const ToolbarButton = c?.ToolbarButton;
export const ToolbarItem = c?.ToolbarItem;
export const ToolbarDropdownMenu = c?.ToolbarDropdownMenu;
export const Dropdown = c?.Dropdown;
export const DropdownMenu = c?.DropdownMenu;
export const MenuGroup = c?.MenuGroup;
export const MenuItem = c?.MenuItem;
export const MenuItemsChoice = c?.MenuItemsChoice;
export const Popover = c?.Popover;
export const TabPanel = c?.TabPanel;
export const ColorPalette = c?.ColorPalette;
export const ColorIndicator = c?.ColorIndicator;
export const ColorPicker = c?.ColorPicker;
// SlotFillProvider wires a block's InspectorControls (Fills) to the
// BlockInspector (Slot) so the embedded editor can show a settings panel.
// Slot / Fill / createSlotFill are the same primitive used by the editor
// toolbar API (ci-editor-chrome.js): editors render Fills, the header renders
// the matching Slots, so any type can contribute toolbar buttons.
export const SlotFillProvider = c?.SlotFillProvider;
export const Slot = c?.Slot;
export const Fill = c?.Fill;
export const createSlotFill = c?.createSlotFill;
// Lets a Slot host react to whether any Fills are registered (e.g. show the
// settings gear only when an editor has contributed inspector content). Stable
// export aliases the still-experimental hook name.
export const __experimentalUseSlotFills = c?.__experimentalUseSlotFills;
export const useSlotFills = c?.useSlotFills || c?.__experimentalUseSlotFills;
// TreeGrid — the accessible tree primitive the block editor's ListView is
// built on (roving tabindex + arrow-key expand/collapse/navigate). Used by
// the sidebar nav for a genuinely Gutenberg-native tree.
export const TreeGrid = c?.__experimentalTreeGrid;
export const TreeGridRow = c?.__experimentalTreeGridRow;
export const TreeGridCell = c?.__experimentalTreeGridCell;
// ItemGroup / Item — WPDS list primitive (the "list" surface DataViews uses).
export const ItemGroup = c?.__experimentalItemGroup;
export const Item = c?.__experimentalItem;

// Consumed by ci-ai-chat.js. Missing these took down the whole admin app: a
// named import of an export this module does not declare is a parse-time
// SyntaxError, so every screen died on a spinner, not just the chat panel.
// The default export cannot cover for a missing named export.
export const DropZone = c?.DropZone;
export const FormFileUpload = c?.FormFileUpload;
export const ResizableBox = c?.ResizableBox;
export const __experimentalConfirmDialog = c?.__experimentalConfirmDialog;

export default c;
