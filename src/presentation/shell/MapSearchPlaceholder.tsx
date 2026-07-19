import SearchIcon from '@mui/icons-material/Search';
import { InputAdornment, Paper, TextField, Tooltip } from '@mui/material';

export function MapSearchPlaceholder() {
  return (
    <Tooltip title="Place search arrives in a later phase">
      <Paper
        elevation={4}
        sx={{
          position: 'absolute',
          top: 6,
          right: 47,
          zIndex: 2,
          width: 330,
          maxWidth: 'calc(100% - 144px)',
          borderRadius: 1.25,
        }}
      >
        <TextField
          disabled
          fullWidth
          hiddenLabel
          size="small"
          aria-label="Search places or coordinates"
          placeholder="Search places or coordinates"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ '& .MuiOutlinedInput-notchedOutline': { border: 0 } }}
        />
      </Paper>
    </Tooltip>
  );
}
