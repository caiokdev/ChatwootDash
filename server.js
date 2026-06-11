require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
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

// Endpoint to list all inboxes
app.get('/api/inboxes', async (req, res) => {
  try {
    const response = await fetch(`${HOST}/api/v1/accounts/${ACCOUNT_ID}/inboxes`, { headers });
    if (!response.ok) throw new Error(`Chatwoot API error: ${response.status}`);
    const data = await response.json();
    const inboxes = data.payload || [];
    res.json(inboxes.map(inbox => ({ id: inbox.id, name: inbox.name })));
  } catch (error) {
    console.error('Error fetching inboxes:', error);
    res.status(500).json({ error: 'Failed to fetch inboxes' });
  }
});

app.get('/api/metrics', async (req, res) => {
  try {
    // Determine the inbox_id to use (from query or fallback to env)
    const activeInboxId = parseInt(req.query.inbox_id, 10) || parseInt(INBOX_ID, 10) || 0;
    const since = req.query.since;
    const until = req.query.until;

    // Chatwoot date filters `is_greater_than` and `is_less_than` are strictly exclusive bounds.
    // To make them inclusive (as expected by users), we must shift `since` by -1 day and `until` by +1 day.
    const adjustDate = (dateStr, daysOffset) => {
        // Parse dateStr "YYYY-MM-DD" as UTC to avoid local timezone shifts
        const d = new Date(dateStr + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + daysOffset);
        return d.toISOString().split('T')[0];
    };

    const chatwootSince = since ? adjustDate(since, -1) : null;
    const chatwootUntil = until ? adjustDate(until, 1) : null;

    // Helper to build payload dynamically
    const buildPayload = (labelTitle, unlabeled = false, status = null) => {
      const payload = [];
      payload.push({ attribute_key: 'inbox_id', filter_operator: 'equal_to', values: [activeInboxId], query_operator: null });
      
      if (labelTitle) {
          payload[payload.length - 1].query_operator = 'AND';
          payload.push({ attribute_key: 'labels', filter_operator: 'equal_to', values: [labelTitle], query_operator: null });
      } else if (unlabeled) {
          payload[payload.length - 1].query_operator = 'AND';
          payload.push({ attribute_key: 'labels', filter_operator: 'is_not_present', values: [''], query_operator: null });
      }

      if (chatwootSince) {
          payload[payload.length - 1].query_operator = 'AND';
          payload.push({ attribute_key: 'created_at', filter_operator: 'is_greater_than', values: [chatwootSince], query_operator: null });
      }
      if (chatwootUntil) {
          payload[payload.length - 1].query_operator = 'AND';
          payload.push({ attribute_key: 'created_at', filter_operator: 'is_less_than', values: [chatwootUntil], query_operator: null });
      }
      if (status) {
          payload[payload.length - 1].query_operator = 'AND';
          payload.push({ attribute_key: 'status', filter_operator: 'equal_to', values: [status], query_operator: null });
      }
      return payload;
    };

    // 1. Fetch total conversations for the inbox
    const totalRes = await fetch(`${HOST}/api/v1/accounts/${ACCOUNT_ID}/conversations/filter`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: buildPayload(null, false) })
    });
    if (!totalRes.ok) throw new Error(`Chatwoot API error on total: ${totalRes.status}`);
    const totalBody = await totalRes.json();
    const totalConversations = totalBody.meta?.all_count || 0;

    // Fetch Open Conversations
    const openPayload = buildPayload(null, false, 'open');
    const openRes = await fetch(`${HOST}/api/v1/accounts/${ACCOUNT_ID}/conversations/filter`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: openPayload })
    });
    const openCount = openRes.ok ? (await openRes.json()).meta?.all_count || 0 : 0;

    // Fetch Resolved Conversations
    const resolvedPayload = buildPayload(null, false, 'resolved');
    const resolvedRes = await fetch(`${HOST}/api/v1/accounts/${ACCOUNT_ID}/conversations/filter`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: resolvedPayload })
    });
    const resolvedCount = resolvedRes.ok ? (await resolvedRes.json()).meta?.all_count || 0 : 0;

    // 2. Fetch all labels
    const labelsRes = await fetch(`${HOST}/api/v1/accounts/${ACCOUNT_ID}/labels`, { headers });
    if (!labelsRes.ok) throw new Error(`Chatwoot API error on labels: ${labelsRes.status}`);
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
        body: JSON.stringify({ payload: buildPayload(label.title, false) })
      });
      if (!labelRes.ok) return { ...label, count: 0 };
      const labelBody = await labelRes.json();
      return {
        ...label,
        count: labelBody.meta?.all_count || 0
      };
    });

    // 4. Also fetch conversations with NO labels
    const unlabeledPromise = (async () => {
      const unlblRes = await fetch(`${HOST}/api/v1/accounts/${ACCOUNT_ID}/conversations/filter`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ payload: buildPayload(null, true) })
      });
      if (!unlblRes.ok) return { title: 'Sem Etiqueta', color: '#4b5563', count: 0 };
      const unlblBody = await unlblRes.json();
      return {
        title: 'Sem Etiqueta',
        color: '#4b5563', // A gray color for unassigned
        count: unlblBody.meta?.all_count || 0,
        description: 'Conversas que não possuem nenhuma etiqueta atribuída.'
      };
    })();

    const labelsWithCounts = await Promise.all([...labelPromises, unlabeledPromise]);

    // Filter out labels that don't have any conversations if you prefer, 
    // or return all of them. Let's return all.
    res.json({
      inboxId: activeInboxId,
      totalConversations,
      openCount,
      resolvedCount,
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
