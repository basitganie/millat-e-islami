const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database Setup (MongoDB Atlas) ─────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('FATAL: MONGO_URI environment variable is not set.');
  console.error('Set it to your MongoDB Atlas connection string before starting the server.');
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
let db, members, projects, meetings, settings;

async function connectDB() {
  await client.connect();
  db = client.db('millat_e_islami');
  members  = db.collection('members');
  projects = db.collection('projects');
  meetings = db.collection('meetings');
  settings = db.collection('settings');
  console.log('Connected to MongoDB Atlas.');
  await initAdmin();
}

function oid(id) {
  try { return new ObjectId(id); } catch { return null; }
}

function withStringId(doc) {
  if (!doc) return doc;
  return { ...doc, _id: doc._id.toString() };
}

// ─── Bootstrap Admin Password + Org Info ─────────────────────────────────────
async function initAdmin() {
  const existing = await settings.findOne({ key: 'admin_password' });
  if (!existing) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin1234', 10);
    await settings.insertOne({ key: 'admin_password', value: hash });
    console.log('Admin password initialized. Default: admin1234 (change this!)');
  }
  const info = await settings.findOne({ key: 'org_info' });
  if (!info) {
    await settings.insertOne({
      key: 'org_info',
      value: {
        name_ur: 'ملت اسلامی',
        name_ar: 'ملة الإسلام',
        name_en: 'Millat-e-Islami',
        tagline_ur: 'ہمارا نظام، ہماری ترقی',
        tagline_en: 'Our System, Our Progress',
        founded: '2020',
        location: 'Kashmir',
        description_ur: 'ملت اسلامی ایک اسلامی ادارہ ہے جو علم، خدمت اور ترقی کے لیے کوشاں ہے۔',
        description_en: 'Millat-e-Islami is an Islamic institution striving for knowledge, service, and progress.'
      }
    });
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'millat-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

const requireAdmin = (req, res, next) => {
  if (req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { password } = req.body;
    const record = await settings.findOne({ key: 'admin_password' });
    const valid = await bcrypt.compare(password, record.value);
    if (!valid) return res.status(401).json({ error: 'Wrong password' });
    req.session.isAdmin = true;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

app.post('/api/auth/change-password', requireAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password too short' });
    const hash = await bcrypt.hash(newPassword, 10);
    await settings.updateOne({ key: 'admin_password' }, { $set: { value: hash } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── SETTINGS ROUTES ─────────────────────────────────────────────────────────
app.get('/api/settings/org', async (req, res) => {
  try {
    const info = await settings.findOne({ key: 'org_info' });
    res.json(info ? info.value : {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings/org', requireAdmin, async (req, res) => {
  try {
    await settings.updateOne({ key: 'org_info' }, { $set: { value: req.body } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const [totalMembers, activeProjects, totalMeetings, completedProjects] = await Promise.all([
      members.countDocuments({}),
      projects.countDocuments({ status: { $in: ['active', 'نافذ'] } }),
      meetings.countDocuments({}),
      projects.countDocuments({ status: { $in: ['completed', 'مکمل'] } }),
    ]);
    const recentMeetings = await meetings.find({}).sort({ date: -1 }).limit(5).toArray();
    const recentProjects = await projects.find({}).sort({ createdAt: -1 }).limit(5).toArray();
    const recentMembers  = await members.find({}).sort({ joinedAt: -1 }).limit(5).toArray();

    res.json({
      stats: { totalMembers, activeProjects, totalMeetings, completedProjects },
      recentMeetings: recentMeetings.map(withStringId),
      recentProjects: recentProjects.map(withStringId),
      recentMembers:  recentMembers.map(withStringId),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── MEMBERS ROUTES ──────────────────────────────────────────────────────────
app.get('/api/members', async (req, res) => {
  try {
    const { search, role } = req.query;
    let query = {};
    if (role) query.role = role;
    let list = await members.find(query).sort({ joinedAt: -1 }).toArray();
    list = list.map(withStringId);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(m =>
        (m.name_ur||'').includes(search) ||
        (m.name_en||'').toLowerCase().includes(s) ||
        (m.role||'').includes(search) ||
        (m.phone||'').includes(search)
      );
    }
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/members/:id', async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    const m = await members.findOne({ _id: id });
    if (!m) return res.status(404).json({ error: 'Not found' });
    res.json(withStringId(m));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/members', requireAdmin, async (req, res) => {
  try {
    const doc = { ...req.body, joinedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
    const result = await members.insertOne(doc);
    res.json(withStringId({ ...doc, _id: result.insertedId }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/members/:id', requireAdmin, async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    await members.updateOne({ _id: id }, { $set: { ...req.body, updatedAt: new Date().toISOString() } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/members/:id', requireAdmin, async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    await members.deleteOne({ _id: id });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── PROJECTS ROUTES ─────────────────────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = {};
    if (status) query.status = status;
    let list = await projects.find(query).sort({ createdAt: -1 }).toArray();
    list = list.map(withStringId);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(p =>
        (p.title_ur||'').includes(search) ||
        (p.title_en||'').toLowerCase().includes(s) ||
        (p.description_ur||'').includes(search)
      );
    }
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/projects/:id', async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    const p = await projects.findOne({ _id: id });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(withStringId(p));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects', requireAdmin, async (req, res) => {
  try {
    const doc = { ...req.body, createdAt: new Date().toISOString(), updates: [] };
    const result = await projects.insertOne(doc);
    res.json(withStringId({ ...doc, _id: result.insertedId }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:id', requireAdmin, async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    await projects.updateOne({ _id: id }, { $set: { ...req.body, updatedAt: new Date().toISOString() } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects/:id/updates', requireAdmin, async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    const { text } = req.body;
    const entry = { text, date: new Date().toISOString() };
    await projects.updateOne({ _id: id }, { $push: { updates: entry } });
    res.json({ success: true, entry });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:id', requireAdmin, async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    await projects.deleteOne({ _id: id });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── MEETINGS ROUTES ─────────────────────────────────────────────────────────
app.get('/api/meetings', async (req, res) => {
  try {
    const list = await meetings.find({}).sort({ date: -1 }).toArray();
    res.json(list.map(withStringId));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/meetings/:id', async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    const m = await meetings.findOne({ _id: id });
    if (!m) return res.status(404).json({ error: 'Not found' });
    res.json(withStringId(m));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/meetings', requireAdmin, async (req, res) => {
  try {
    const doc = { ...req.body, createdAt: new Date().toISOString() };
    const result = await meetings.insertOne(doc);
    res.json(withStringId({ ...doc, _id: result.insertedId }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/meetings/:id', requireAdmin, async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    await meetings.updateOne({ _id: id }, { $set: { ...req.body, updatedAt: new Date().toISOString() } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/meetings/:id', requireAdmin, async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    await meetings.deleteOne({ _id: id });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── Serve SPA ────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Millat-e-Islami Log System running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
