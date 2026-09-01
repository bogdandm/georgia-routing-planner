import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Popover,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState, type MouseEvent } from 'react';

import {
  normalizeMarkerName,
  type MarkerColorKey,
  type MarkerIconKey,
  type NormalizedMarkerName,
  type SavedMarker,
} from '@/domain/markers/savedMarker';
import {
  markerColorCatalog,
  markerIconCatalog,
  markerIconCategories,
  markerIconFor,
  type MarkerIconCategory,
} from '@/presentation/markers/markerCatalog';
import { PinheadIcon } from '@/presentation/markers/PinheadIcon';
import { appColors } from '@/presentation/theme/appColors';

export interface MarkerAppearance {
  readonly iconKey: MarkerIconKey;
  readonly colorKey: MarkerColorKey;
}

interface MarkerEditorDialogBaseProps {
  readonly open: boolean;
  readonly onCancel: () => void;
}

interface CreateMarkerEditorDialogProps extends MarkerEditorDialogBaseProps {
  readonly mode: 'create';
  readonly initialName: string;
  readonly onSubmit: (
    name: NormalizedMarkerName,
    appearance: MarkerAppearance,
  ) => Promise<void>;
}
interface NameOnlyMarkerEditorDialogProps extends MarkerEditorDialogBaseProps {
  readonly mode: 'name-only';
  readonly initialName: string;
  readonly title: 'Create track marker';
  readonly onSubmit: (name: NormalizedMarkerName) => Promise<void>;
}

interface AppearanceMarkerEditorDialogProps extends MarkerEditorDialogBaseProps {
  readonly mode: 'appearance';
  readonly marker: SavedMarker;
  readonly onSubmit: (appearance: MarkerAppearance) => Promise<void>;
}

type MarkerEditorDialogProps =
  | CreateMarkerEditorDialogProps
  | NameOnlyMarkerEditorDialogProps
  | AppearanceMarkerEditorDialogProps;

const markerIconCategoryRows = [
  markerIconCategories.slice(0, 4),
  markerIconCategories.slice(4),
] as const;

export function MarkerEditorDialog(props: MarkerEditorDialogProps) {
  if (!props.open) return null;
  const key =
    props.mode === 'appearance'
      ? props.marker.id
      : `${props.mode}:${props.initialName}`;
  return <OpenMarkerEditorDialog key={key} {...props} />;
}

function OpenMarkerEditorDialog(props: MarkerEditorDialogProps) {
  const editorMarker = props.mode === 'appearance' ? props.marker : null;
  const initialName =
    props.mode === 'appearance' ? (editorMarker?.name ?? '') : props.initialName;
  const [name, setName] = useState(initialName);
  const [iconKey, setIconKey] = useState<MarkerIconKey>(
    () => editorMarker?.iconKey ?? 'place',
  );
  const [colorKey, setColorKey] = useState<MarkerColorKey>(
    () => editorMarker?.colorKey ?? 'blue',
  );
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null);
  const [iconQuery, setIconQuery] = useState('');
  const [iconCategory, setIconCategory] = useState<MarkerIconCategory>(
    () => markerIconFor(iconKey).category,
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selectedIcon = markerIconFor(iconKey);
  const filteredIcons = useMemo(() => {
    if (props.mode === 'name-only') return [];
    const query = iconQuery.trim().toLocaleLowerCase('en');
    return markerIconCatalog.filter(
      (entry) =>
        (query.length > 0 || entry.category === iconCategory) &&
        (query.length === 0 ||
          entry.label.toLocaleLowerCase('en').includes(query) ||
          entry.category.toLocaleLowerCase('en').includes(query)),
    );
  }, [iconCategory, iconQuery, props.mode]);

  const openIconPicker = (event: MouseEvent<HTMLElement>) => {
    setIconAnchor(event.currentTarget);
  };

  const submit = async () => {
    let normalized: NormalizedMarkerName | undefined;
    if (props.mode !== 'appearance') {
      try {
        normalized = normalizeMarkerName(name);
        setValidationError(null);
      } catch (error) {
        setValidationError(
          error instanceof Error ? error.message : 'The marker name is invalid.',
        );
        return;
      }
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const appearance = { iconKey, colorKey } as const;
      if (props.mode === 'create') {
        if (normalized === undefined) return;
        await props.onSubmit(normalized, appearance);
      } else if (props.mode === 'name-only') {
        if (normalized === undefined) return;
        await props.onSubmit(normalized);
      } else {
        await props.onSubmit(appearance);
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'The marker could not be saved.',
      );
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      aria-labelledby="marker-editor-title"
      maxWidth="xs"
      fullWidth
      onClose={saving ? undefined : props.onCancel}
    >
      <DialogTitle id="marker-editor-title">
        {props.mode === 'create'
          ? 'Create marker'
          : props.mode === 'name-only'
            ? props.title
            : 'Marker appearance'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {props.mode !== 'appearance' ? (
            <TextField
              autoFocus
              label="Marker name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setValidationError(null);
                setSubmitError(null);
              }}
              error={validationError !== null}
              helperText={validationError}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          ) : null}
          {submitError !== null ? <Alert severity="error">{submitError}</Alert> : null}
          {props.mode === 'name-only' ? null : (
            <Stack spacing={1}>
              <Button
                aria-label={`Choose marker icon. Current: ${selectedIcon.label}`}
                onClick={openIconPicker}
                variant="outlined"
                size="small"
                startIcon={<PinheadIcon svg={selectedIcon.svg} size={18} />}
                endIcon={<ExpandMoreIcon />}
                sx={{
                  minWidth: 0,
                  maxWidth: '100%',
                  px: 1.25,
                  justifyContent: 'start',
                  '& .MuiButton-startIcon, & .MuiButton-endIcon': { flexShrink: 0 },
                }}
              >
                <Typography component="span" variant="inherit" noWrap>
                  {selectedIcon.label}
                </Typography>
              </Button>
              <Box
                role="group"
                aria-label="Marker color"
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 0.5,
                  justifyContent: 'flex-start',
                }}
              >
                {markerColorCatalog.map((color) => {
                  const selected = color.key === colorKey;
                  return (
                    <Tooltip key={color.key} title={color.label}>
                      <IconButton
                        aria-label={`Choose ${color.key} marker color`}
                        aria-pressed={selected}
                        size="small"
                        onClick={() => {
                          setColorKey(color.key);
                          setSubmitError(null);
                        }}
                        sx={{ width: 26, height: 26, p: 0.25 }}
                      >
                        <Box
                          aria-hidden
                          sx={{
                            display: 'grid',
                            placeItems: 'center',
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            bgcolor: color.value,
                            border: '1px solid',
                            borderColor: 'common.white',
                            boxShadow: selected
                              ? `0 0 0 2px ${appColors.surface.panel}, 0 0 0 4px ${color.value}`
                              : `0 0 0 1px color-mix(in srgb, ${color.value}, transparent 25%)`,
                          }}
                        >
                          {selected ? (
                            <CheckIcon sx={{ color: 'common.white', fontSize: 14 }} />
                          ) : null}
                        </Box>
                      </IconButton>
                    </Tooltip>
                  );
                })}
              </Box>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={saving} variant="contained">
          {props.mode === 'appearance' ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
      {props.mode === 'name-only' ? null : (
        <Popover
          open={iconAnchor !== null}
          anchorEl={iconAnchor}
          onClose={() => {
            setIconAnchor(null);
            setIconQuery('');
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Box sx={{ width: 420, maxWidth: 'calc(100vw - 32px)', p: 1 }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              aria-label="Search marker icons"
              placeholder={`Search ${String(markerIconCatalog.length)} icons`}
              value={iconQuery}
              onChange={(event) => {
                setIconQuery(event.target.value);
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Stack spacing={0} sx={{ mt: 0.5 }}>
              {markerIconCategoryRows.map((categories, rowIndex) => (
                <Tabs
                  key={rowIndex}
                  value={categories.includes(iconCategory) ? iconCategory : false}
                  onChange={(_event, category: MarkerIconCategory) => {
                    setIconCategory(category);
                  }}
                  variant="fullWidth"
                  aria-label={`Marker icon categories row ${String(rowIndex + 1)}`}
                  sx={{
                    minHeight: 36,
                    '& .MuiTab-root': {
                      minHeight: 36,
                      minWidth: 0,
                      m: 0,
                      px: 0.75,
                      borderRadius: 0,
                      bgcolor: 'transparent',
                      color: 'text.secondary',
                      fontSize: '0.75rem',
                      whiteSpace: 'nowrap',
                    },
                    '& .MuiTab-root.Mui-selected': {
                      bgcolor: 'transparent',
                      color: 'primary.main',
                    },
                    '& .MuiTabs-indicator': {
                      height: 2,
                      borderRadius: 0,
                    },
                  }}
                >
                  {categories.map((category) => (
                    <Tab key={category} value={category} label={category} />
                  ))}
                </Tabs>
              ))}
            </Stack>
            <Box
              role="listbox"
              aria-label="Marker icons"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: 0.5,
                maxHeight: 280,
                overflowY: 'auto',
                mt: 1,
              }}
            >
              {filteredIcons.map(({ key, label, svg }) => {
                const selected = key === iconKey;
                return (
                  <Tooltip key={key} title={label}>
                    <IconButton
                      role="option"
                      aria-label={`Choose ${label} icon`}
                      aria-selected={selected}
                      color={selected ? 'primary' : 'default'}
                      onClick={() => {
                        setIconKey(key);
                        setIconCategory(markerIconFor(key).category);
                        setSubmitError(null);
                        setIconAnchor(null);
                        setIconQuery('');
                      }}
                      sx={{
                        border: '1px solid',
                        borderColor: selected ? 'primary.main' : 'transparent',
                        borderRadius: 1,
                      }}
                    >
                      <PinheadIcon svg={svg} size={24} />
                    </IconButton>
                  </Tooltip>
                );
              })}
            </Box>
            {filteredIcons.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                No matching icons
              </Typography>
            ) : null}
          </Box>
        </Popover>
      )}
    </Dialog>
  );
}
