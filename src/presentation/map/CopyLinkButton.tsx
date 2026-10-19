import { Trans } from '@lingui/react/macro';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import { Box, Button } from '@mui/material';
import { useEffect, useState } from 'react';

const copiedFeedbackMs = 2_000;

/**
 * A copy button of the Share dialog that confirms a successful copy in place with
 * **Copied** for two seconds. `copy` resolves `false` when the clipboard write failed,
 * which the caller reports. Both labels share one grid cell so the width never jumps.
 */
export function CopyLinkButton({
  label,
  copy,
  disabled,
  variant,
}: {
  readonly label: string;
  readonly copy: () => Promise<boolean>;
  readonly disabled: boolean;
  readonly variant: 'contained' | 'outlined';
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timeout = window.setTimeout(() => {
      setCopied(false);
    }, copiedFeedbackMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [copied]);

  return (
    <Button
      size="small"
      variant={variant}
      disabled={disabled}
      startIcon={copied ? <CheckIcon /> : <ContentCopyOutlinedIcon />}
      onClick={() => {
        void copy().then((succeeded) => {
          if (succeeded) setCopied(true);
        });
      }}
      sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
    >
      <Box component="span" sx={{ display: 'grid' }}>
        <Box
          component="span"
          aria-hidden={copied}
          sx={{ gridArea: '1 / 1', visibility: copied ? 'hidden' : 'visible' }}
        >
          {label}
        </Box>
        <Box
          component="span"
          aria-hidden={!copied}
          sx={{ gridArea: '1 / 1', visibility: copied ? 'visible' : 'hidden' }}
        >
          <Trans>Copied</Trans>
        </Box>
      </Box>
    </Button>
  );
}
