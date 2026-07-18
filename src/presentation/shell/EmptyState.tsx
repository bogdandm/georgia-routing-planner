import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
}

export function EmptyState({ description, icon, title }: EmptyStateProps) {
  return (
    <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
      <Box aria-hidden sx={{ mb: 1, color: 'primary.main' }}>
        {icon}
      </Box>
      <Typography component="h2" variant="subtitle1" color="text.primary">
        {title}
      </Typography>
      <Typography variant="body2">{description}</Typography>
    </Box>
  );
}
