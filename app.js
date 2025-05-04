const express = require('express');
const axios = require('axios');
const readline = require('readline');
const { v4: uuidv4 } = require('uuid');
const { PassThrough } = require('stream');
const compression = require('compression');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const { checkAuth } = require('./middleware/auth');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;
let watchIndex = 0;
const selectedChannels = [];
let currentChannel = null;

// Replace the plain-text password approach with a hashed one
// Store hashed password in environment variable or generate one for first use
let PASSWORD_HASH = process.env.PASSWORD_HASH;

// If no password hash exists, create one from the default password for first use
if (!PASSWORD_HASH) {
  const saltRounds = 10;
  // This is just for initial setup - in production, set PASSWORD_HASH in .env
  PASSWORD_HASH = bcrypt.hashSync('admin123', saltRounds);
  console.log('WARNING: Using default password. Set PASSWORD_HASH in .env file for production.');
}

let M3U_URL = 'http://wanicelife.com:8880/get.php?username=D12m4389&password=60388773&type=m3u_plus&output=m3u8';
// const M3U_URL = 'http://hdhd.tk:80/get.php?username=Cdegale&password=022275&type=m3u_plus&output=m3u8';

app.get("/", (req, res) => {
    // res.sendFile(path.join(__dirname, 'public', 'index.html'));
    res.json({ message: 'working' });
})

app.use(express.static('public'));
app.use(cors());
app.use(compression());

function cleanName(raw) {
    if (!raw) return 'Unknown';
  
    return raw
      .replace(/[-|]+/g, ' ') // convert repeated - or | to spaces
      .replace(/\s{2,}/g, ' ') // collapse multiple spaces
      .replace(/^[:\s]+|[:\s]+$/g, '') // trim colons and spaces from start/end
      .trim();
  }
  

// Streaming M3U parser
async function parseM3UStreamed(url) {
    const response = await axios({
        method: 'get',
        url,
        responseType: 'stream',
        timeout: 15000, // 15 sec timeout
    });

    const rl = readline.createInterface({
        input: response.data.pipe(new PassThrough()),
        crlfDelay: Infinity,
    });

    const channels = [];
    let currentLine = '';

    for await (const line of rl) {
        if (line.startsWith('#EXTINF')) {
            currentLine = line;
        } else if (line.startsWith('http')) {
            // Parse the #EXTINF line and the following URL
            const nameMatch = currentLine.match(/tvg-name="([^"]+)"/);
            const logoMatch = currentLine.match(/tvg-logo="([^"]+)"/);
            const groupMatch = currentLine.match(/group-title="([^"]+)"/);
            const idMatch = currentLine.match(/tvg-id="([^"]+)"/);

            channels.push({
                id: idMatch && idMatch[1] ? idMatch[1].replace(/[^a-zA-Z0-9]/g, '') : uuidv4(),
                name: cleanName(nameMatch ? nameMatch[1] : 'Unknown'),
                icon_url: logoMatch ? logoMatch[1] : null,
                streaming_url: line,
                group_title: groupMatch ? groupMatch[1] : null,
              });
              

            currentLine = '';
        }
    }

    return channels;
}

// Route to return parsed channels
app.get('/api/channels', async (req, res) => {
    try {
        const channels = await parseM3UStreamed(M3U_URL);

        // Pagination logic
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;

        const paginated = channels.slice(startIndex, endIndex);

        res.json({
            total: channels.length,
            page,
            limit,
            data: paginated,
        });
    } catch (err) {
        console.error('Stream error:', err.message);
        res.status(500).json({ error: 'Failed to stream and parse playlist.' });
    }
});

// Route: Get all unique group titles
app.get('/api/groups', async (req, res) => {
    try {
        const channels = await parseM3UStreamed(M3U_URL);
        const groups = [...new Set(channels.map(c => c.group_title).filter(Boolean))];
        res.json(groups);
    } catch (err) {
        console.error('Error fetching groups:', err.message);
        res.status(500).json({ error: 'Failed to fetch group titles.' });
    }
});

// Route: Get channels by group_title
app.get('/api/channels/by-group/:group', async (req, res) => {
    try {
        const groupParam = decodeURIComponent(req.params.group).toLowerCase();
        const channels = await parseM3UStreamed(M3U_URL);

        const filtered = channels.filter(c =>
            c.group_title && c.group_title.toLowerCase() === groupParam
        );

        res.json({
            total: filtered.length,
            group: req.params.group,
            data: filtered,
        });
    } catch (err) {
        console.error('Error filtering by group:', err.message);
        res.status(500).json({ error: 'Failed to filter channels by group.' });
    }
});


app.get('/api/channels/search', async (req, res) => {
    try {
      const { q = '', group = '', page = 1, limit = 50 } = req.query;
      const channels = await parseM3UStreamed(M3U_URL);
  
      const filtered = channels.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(q.toLowerCase());
        const matchesGroup = group ? c.group_title?.toLowerCase() === group.toLowerCase() : true;
        return matchesSearch && matchesGroup;
      });
  
      const start = (page - 1) * limit;
      const paginated = filtered.slice(start, start + Number(limit));
  
      res.json({
        total: filtered.length,
        page: Number(page),
        limit: Number(limit),
        data: paginated,
      });
    } catch (err) {
      console.error('Search error:', err.message);
      res.status(500).json({ error: 'Failed to search channels.' });
    }
  });

// Authentication endpoint
app.post('/api/auth', express.json(), async (req, res) => {
    const { password } = req.body;
    
    if (!password) {
        return res.status(400).json({ message: 'Password is required' });
    }
    
    try {
        // Compare submitted password with stored hash
        const passwordMatches = await bcrypt.compare(password, PASSWORD_HASH);
        
        if (!passwordMatches) {
            return res.status(401).json({ message: 'Invalid password' });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { authorized: true },
            process.env.AUTH_SECRET || 'your_auth_secret',
            { expiresIn: '24h' } // Token expires in 24 hours
        );
        
        res.json({ token, message: 'Authentication successful' });
    } catch (err) {
        console.error('Authentication error:', err);
        res.status(500).json({ message: 'Server error during authentication' });
    }
});

// Protected route - now requires authentication
app.post('/api/selected', express.json(), checkAuth, (req, res) => {
    const { channels } = req.body;
    
    if (!Array.isArray(channels)) {
        return res.status(400).json({ error: 'Invalid data format.' });
    }
    
    for (const ch of channels) {
        if (!selectedChannels.find(c => c.id === ch.id)) {
            selectedChannels.push(ch);
        }
    }
    
    res.json({ message: 'Channels added.', selectedCount: selectedChannels.length });
});

app.get('/api/selected', (req, res) => {
  res.json(selectedChannels);
});

// Update the stream/:index endpoint to use authentication
app.get("/stream/:index", checkAuth, async (req, res) => {
    const channelId = req.params.index || watchIndex;
    const channel = selectedChannels.find(c => c.id === channelId);

    if (!channel) {
        return res.status(404).json({ error: 'Channel not found.' });
    }

    currentChannel = channel; // Update currentChannel to the selected channel
    console.log(`Streaming channel: ${channel.name} (${channelId})`);

    res.json({status: "playing", channel});
});

app.get("/stream", async (req, res) => {
    if (!currentChannel){
        return res.status(404).json({ error: 'No channel selected for streaming.' });
    }
    const channel = currentChannel; // Use the current channel for streaming
    const streamUrl = channel.streaming_url;

    res.redirect(streamUrl); // Redirect to the streaming URL
})

// Add this route to handle M3U_URL updates
app.post('/api/admin/update-m3u-url', express.json(), checkAuth, (req, res) => {
    const { newUrl } = req.body;
    
    if (!newUrl) {
        return res.status(400).json({ error: 'New URL is required' });
    }
    
    try {
        // Validate URL (basic check)
        new URL(newUrl);
        
        // Update the M3U_URL
        M3U_URL = newUrl;
        
        return res.json({ 
            success: true, 
            message: 'M3U URL updated successfully',
            currentUrl: M3U_URL
        });
    } catch (err) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }
});

// Add this route to get the current M3U_URL (protected)
app.get('/api/admin/m3u-url', checkAuth, (req, res) => {
    res.json({ url: M3U_URL });
});

// Protected endpoint to update the admin password
app.post('/api/admin/update-password', express.json(), checkAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new passwords are required' });
    }
    
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }
    
    try {
        // Verify current password
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, PASSWORD_HASH);
        if (!isCurrentPasswordValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        // Hash new password
        const saltRounds = 10;
        const newHash = await bcrypt.hash(newPassword, saltRounds);
        
        // Update the PASSWORD_HASH variable
        PASSWORD_HASH = newHash;
        
        // In a production environment, you might want to save this to a database
        // or update your .env file
        console.log('Password updated successfully. New hash:', PASSWORD_HASH);
        
        return res.json({ 
            success: true, 
            message: 'Password updated successfully. You will need to login again with your new password.'
        });
    } catch (err) {
        console.error('Password update error:', err);
        return res.status(500).json({ error: 'Server error during password update' });
    }
});

app.get("/browse", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
})


// empty the selected channels
app.get('/api/admin/clear-selected', checkAuth, (req, res) => {
    selectedChannels.length = 0; // Clear the array
    res.json({ message: 'Selected channels cleared.' });
});

app.get("/password", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'password.html'));
})

app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
})

app.get("/channels", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'channels.html'));
})

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

app.listen(PORT, () => {
    console.log(`Streaming server running at http://localhost:${PORT}`);
});