require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const HOST = process.env.CHATWOOT_HOST;
const TOKEN = process.env.CHATWOOT_API_TOKEN;
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const INBOX_ID = process.env.CHATWOOT_INBOX_ID;
const TARGET_LABELS = process.env.TARGET_LABELS ? process.env.TARGET_LABELS.split(',').map(l => l.trim()) : [];

const headers = {
  'api_access_token': TOKEN,
  'Content-Type': 'application/json'
};

app.get('/api/metrics', async (req, res) => {
  try {
    // 1. Fetch total conversations for the inbox
    const totalRes = await fetch(`${HOST}/api/v1/accounts/${ACCOUNT_ID}/conversations/filter`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        payload: [
          { attribute_key: 'inbox_id', filter_operator: 'equal_to', values: [Number(INBOX_ID)], query_operator: null }
        ]
      })
    });
    const totalBody = await totalRes.json();
    const totalConversations = totalBody.meta?.all_count || 0;
    const unassignedCount = totalBody.meta?.unassigned_count || 0;
    const mineCount = totalBody.meta?.mine_count || 0;

    // 2. Fetch all labels
    const labelsRes = await fetch(`${HOST}/api/v1/accounts/${ACCOUNT_ID}/labels`, { headers });
    const allLabels = await labelsRes.json();
    let labels = allLabels.payload || [];

    // If TARGET_LABELS is defined, filter the labels list to only include those
    if (TARGET_LABELS.length > 0) {
      labels = labels.filter(label => TARGET_LABELS.includes(label.title));
    }

    // 3. For each label, fetch the count of conversations in this inbox
    // We do this in parallel to be fast
    const labelPromises = labels.map(async (label) => {
      const labelRes = await fetch(`${HOST}/api/v1/accounts/${ACCOUNT_ID}/conversations/filter`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          payload: [
            { attribute_key: 'inbox_id', filter_operator: 'equal_to', values: [Number(INBOX_ID)], query_operator: 'AND' },
            { attribute_key: 'labels', filter_operator: 'equal_to', values: [label.title], query_operator: null }
          ]
        })
      });
      const labelBody = await labelRes.json();
      return {
        ...label,
        count: labelBody.meta?.all_count || 0
      };
    });

    const labelsWithCounts = await Promise.all(labelPromises);

    // Filter out labels that don't have any conversations if you prefer, 
    // or return all of them. Let's return all.
    res.json({
      inboxId: INBOX_ID,
      totalConversations,
      unassignedCount,
      mineCount,
      labels: labelsWithCounts
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics from Chatwoot' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
