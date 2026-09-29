import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Button,
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

import type { MarkerIconKey } from '@/domain/markers/savedMarker';
import {
  markerIconCatalog,
  markerIconCategories,
  markerIconFor,
  type MarkerIconCategory,
} from '@/presentation/markers/markerCatalog';
import { PinheadIcon } from '@/presentation/markers/PinheadIcon';

export type SelectableIconKey = MarkerIconKey | 'folder';

type MarkerIconSection = 'Recently used' | MarkerIconCategory;

const markerIconSections: readonly MarkerIconSection[] = [
  'Recently used',
  ...markerIconCategories,
];
const markerIconSectionRows = [
  markerIconSections.slice(0, 4),
  markerIconSections.slice(4),
] as const;

const markerIconSectionLabels: Readonly<Record<MarkerIconSection, MessageDescriptor>> =
  {
    'Recently used': msg`Recently used`,
    Places: msg`Places`,
    Nature: msg`Nature`,
    Activities: msg`Activities`,
    'Food & stay': msg`Food & stay`,
    Landmarks: msg`Landmarks`,
    Safety: msg`Safety`,
    Transport: msg`Transport`,
  };

interface MarkerIconPickerProps {
  readonly value: SelectableIconKey;
  readonly recentIconKeys: readonly MarkerIconKey[];
  readonly allowFolder?: boolean;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onChange: (iconKey: SelectableIconKey) => void;
}

export function SelectableIconGlyph({
  iconKey,
  size,
}: {
  readonly iconKey: SelectableIconKey;
  readonly size: number;
}) {
  return iconKey === 'folder' ? (
    <FolderOutlinedIcon sx={{ fontSize: size }} />
  ) : (
    <PinheadIcon svg={markerIconFor(iconKey).svg} size={size} />
  );
}

export function MarkerIconPicker({
  value,
  recentIconKeys,
  allowFolder = false,
  label,
  disabled = false,
  onChange,
}: MarkerIconPickerProps) {
  const { i18n, t } = useLingui();
  const locale = i18n.locale;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<MarkerIconSection>(() =>
    recentIconKeys.length > 0
      ? 'Recently used'
      : value === 'folder'
        ? 'Places'
        : markerIconFor(value).category,
  );
  const recentIcons = useMemo(
    () => recentIconKeys.slice(0, 21).map((key) => markerIconFor(key)),
    [recentIconKeys],
  );
  const filteredIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    if (normalizedQuery.length === 0) {
      return section === 'Recently used'
        ? recentIcons
        : markerIconCatalog.filter((entry) => entry.category === section);
    }
    return markerIconCatalog.filter((entry) => {
      const localizedLabel = i18n._(entry.labelMessage);
      const localizedCategory = i18n._(markerIconSectionLabels[entry.category]);
      return (
        entry.label.toLocaleLowerCase('en').includes(normalizedQuery) ||
        entry.category.toLocaleLowerCase('en').includes(normalizedQuery) ||
        localizedLabel.toLocaleLowerCase(locale).includes(normalizedQuery) ||
        localizedCategory.toLocaleLowerCase(locale).includes(normalizedQuery)
      );
    });
  }, [i18n, locale, query, recentIcons, section]);
  const folderLabel = t`Folder`;
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const showFolder =
    allowFolder &&
    (normalizedQuery.length === 0 ||
      'folder'.includes(normalizedQuery) ||
      folderLabel.toLocaleLowerCase(locale).includes(normalizedQuery));
  const selectedLabel =
    value === 'folder' ? folderLabel : i18n._(markerIconFor(value).labelMessage);
  const close = () => {
    setAnchor(null);
    setQuery('');
  };
  const select = (iconKey: SelectableIconKey) => {
    onChange(iconKey);
    if (iconKey !== 'folder') setSection(markerIconFor(iconKey).category);
    close();
  };
  const open = (event: MouseEvent<HTMLElement>) => {
    setAnchor(event.currentTarget);
  };

  return (
    <>
      <Button
        aria-label={t`${label}. Current: ${selectedLabel}`}
        disabled={disabled}
        onClick={open}
        variant="outlined"
        size="small"
        startIcon={<SelectableIconGlyph iconKey={value} size={18} />}
        endIcon={<ExpandMoreIcon />}
        sx={{
          alignSelf: 'flex-start',
          minWidth: 0,
          maxWidth: '100%',
          px: 1.25,
          justifyContent: 'start',
          '& .MuiButton-startIcon, & .MuiButton-endIcon': { flexShrink: 0 },
        }}
      >
        <Typography component="span" variant="inherit" noWrap>
          {selectedLabel}
        </Typography>
      </Button>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ width: 420, maxWidth: 'calc(100vw - 32px)', p: 1 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            type="search"
            placeholder={t`Search ${markerIconCatalog.length + Number(allowFolder)} icons`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            slotProps={{
              htmlInput: { 'aria-label': t`Search icons` },
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
            {markerIconSectionRows.map((sections, rowIndex) => (
              <Tabs
                key={rowIndex}
                value={sections.includes(section) ? section : false}
                onChange={(_event, nextSection: MarkerIconSection) => {
                  setSection(nextSection);
                }}
                variant="fullWidth"
                aria-label={t`Marker icon categories row ${rowIndex + 1}`}
                sx={{
                  minHeight: 36,
                  '& .MuiTab-root': {
                    minHeight: 36,
                    minWidth: 0,
                    m: 0,
                    px: 0.75,
                    color: 'text.secondary',
                    fontSize: '0.75rem',
                    whiteSpace: 'nowrap',
                  },
                  '& .MuiTab-root.Mui-selected': { color: 'primary.main' },
                  '& .MuiTabs-indicator': { height: 2 },
                }}
              >
                {sections.map((candidate) => (
                  <Tab
                    key={candidate}
                    value={candidate}
                    label={i18n._(markerIconSectionLabels[candidate])}
                  />
                ))}
              </Tabs>
            ))}
          </Stack>
          <Box
            role="listbox"
            aria-label={t`Icons`}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 0.5,
              maxHeight: 280,
              overflowY: 'auto',
              mt: 1,
            }}
          >
            {showFolder ? (
              <Tooltip title={t`Folder`}>
                <IconButton
                  role="option"
                  aria-label={t`Choose Folder icon`}
                  aria-selected={value === 'folder'}
                  color={value === 'folder' ? 'primary' : 'default'}
                  onClick={() => {
                    select('folder');
                  }}
                  sx={{
                    border: '1px solid',
                    borderColor: value === 'folder' ? 'primary.main' : 'transparent',
                    borderRadius: 1,
                  }}
                >
                  <SelectableIconGlyph iconKey="folder" size={24} />
                </IconButton>
              </Tooltip>
            ) : null}
            {filteredIcons.map(({ key, labelMessage, svg }) => {
              const selected = key === value;
              const iconLabel = i18n._(labelMessage);
              return (
                <Tooltip key={key} title={iconLabel}>
                  <IconButton
                    role="option"
                    aria-label={t`Choose ${iconLabel} icon`}
                    aria-selected={selected}
                    color={selected ? 'primary' : 'default'}
                    onClick={() => {
                      select(key);
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
          {!showFolder && filteredIcons.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
              {section === 'Recently used' && query.length === 0
                ? t`No recently used icons yet`
                : t`No matching icons`}
            </Typography>
          ) : null}
        </Box>
      </Popover>
    </>
  );
}
