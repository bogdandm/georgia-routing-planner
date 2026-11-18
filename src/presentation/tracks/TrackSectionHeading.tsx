import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ButtonBase, Typography } from '@mui/material';

/** Shared keyboard-accessible heading for the collapsible track sections. */
export function TrackSectionHeading({
  title,
  label = title,
  detailsId,
  expanded,
  onToggle,
  compact = false,
}: {
  readonly title: string;
  readonly label?: string;
  readonly detailsId: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly compact?: boolean;
}) {
  return (
    <ButtonBase
      aria-label={label}
      aria-controls={detailsId}
      aria-expanded={expanded}
      onClick={onToggle}
      sx={{
        width: '100%',
        minWidth: 0,
        minHeight: compact ? 32 : 44,
        justifyContent: 'space-between',
        px: 1,
        textAlign: 'left',
      }}
    >
      <Typography component="h3" variant="subtitle2">
        {title}
      </Typography>
      <ExpandMoreIcon
        aria-hidden
        fontSize="small"
        sx={{
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: (theme) =>
            theme.transitions.create('transform', {
              duration: theme.transitions.duration.shortest,
            }),
        }}
      />
    </ButtonBase>
  );
}
