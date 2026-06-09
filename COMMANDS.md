# Commands & Skills — RXTrack

Quick reference for all available commands and skills in this project.


## Dev Commands

```bash
# Start dev server
cd ~/rxtrack && npm run dev

# Run tests
cd ~/rxtrack && npm run test

# Build for production
cd ~/rxtrack && npm run build
```


## NotebookLM Pipeline Commands

```bash
# List all NotebookLM notebooks
cd ~/projects/notebooklm-loader && uv run notebooklm list

# Scrape a YouTube channel
python3 ~/.claude/skills/notebooklm/scripts/load_channel.py scrape \
  --channel "https://www.youtube.com/@ChannelName" \
  --output /tmp/channel-videos.json

# Create a new notebook
cd ~/projects/notebooklm-loader && uv run notebooklm create "Notebook Name"

# Query a notebook
nlm notebook query {notebook-id} "{question}" --json > /tmp/qa-output.json

# Re-authenticate (if auth expires)
cd ~/projects/notebooklm-loader && uv run notebooklm login
```


## RXTrack Data Import

To import objectives into rxtrack:
1. Generate a JSON file in the format:
   ```json
   {
     "rxt-block-objectives": {
       "block-id": [ ...objectives ]
     }
   }
   ```
2. Open rxtrack in browser
3. Use the JSON import dialog in the UI
4. Paste or upload the file


## RXTrack Data Export (browser console)

```js
// Run in browser console while rxtrack is open
const keys = Object.keys(localStorage).filter(k => k.startsWith('rxt-'));
const data = {};
keys.forEach(k => data[k] = JSON.parse(localStorage.getItem(k)));
const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = `rxtrack-backup-${new Date().toISOString().split('T')[0]}.json`;
a.click();
```


## Skills (in 06 Skills/)

_No project-specific skills yet._
