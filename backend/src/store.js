// Persistence layer: Firestore when GOOGLE_CLOUD_PROJECT is set, in-memory otherwise.
// Collections: memories, reminders, agent_log, family_messages, alerts, health_log.

class MemoryStore {
  constructor() {
    this.memories = [];
    this.reminders = [];
    this.agentLog = [];
    this.familyMessages = [];
    this.alerts = [];
    this.healthLog = [];
    this.mode = 'memory';
  }
  async saveHealthLog(entry) { // one record per date+period, upserted
    const key = `${entry.date}_${entry.period}`;
    const i = this.healthLog.findIndex(h => `${h.date}_${h.period}` === key);
    const rec = { ...entry, at: Date.now() };
    if (i >= 0) this.healthLog[i] = rec; else this.healthLog.push(rec);
    return key;
  }
  async listHealthLog(days = 7) {
    const cutoff = Date.now() - days * 86400_000;
    return this.healthLog.filter(h => h.at >= cutoff).sort((a, b) => b.at - a.at);
  }
  async saveMemory(entry) {
    this.memories.push({ ...entry, at: Date.now() });
    if (this.memories.length > 50) this.memories.shift();
  }
  async latestMemory() {
    return this.memories.at(-1) || null;
  }
  async addReminder(r) {
    const id = `r${Date.now()}${Math.floor(Math.random() * 1e4)}`;
    this.reminders.push({ id, fired: false, ...r });
    return id;
  }
  async dueReminders(now) {
    const due = this.reminders.filter(r => !r.fired && r.at <= now);
    due.forEach(r => { r.fired = true; });
    return due;
  }
  async listReminders() {
    return this.reminders.filter(r => !r.fired);
  }
  async log(event) {
    this.agentLog.push({ ...event, at: Date.now() });
    if (this.agentLog.length > 500) this.agentLog.shift();
    console.log(`[agent] ${event.type}: ${JSON.stringify(event)}`);
  }
  async addFamilyMessage(m) {
    this.familyMessages.push({ ...m, at: Date.now() });
    if (this.familyMessages.length > 100) this.familyMessages.shift();
  }
  async setAlert(alert) {
    this.alerts.push({ ...alert, at: Date.now() });
  }
  async latestAlert() {
    return this.alerts.at(-1) || null;
  }
}

class FirestoreStore {
  constructor(db) {
    this.db = db;
    this.mode = 'firestore';
  }
  async saveMemory(entry) {
    await this.db.collection('memories').add({ ...entry, at: Date.now() });
  }
  async latestMemory() {
    const snap = await this.db.collection('memories').orderBy('at', 'desc').limit(1).get();
    return snap.empty ? null : snap.docs[0].data();
  }
  async addReminder(r) {
    const ref = await this.db.collection('reminders').add({ fired: false, ...r });
    return ref.id;
  }
  async dueReminders(now) {
    const snap = await this.db.collection('reminders')
      .where('fired', '==', false).where('at', '<=', now).get();
    const batch = this.db.batch();
    const due = snap.docs.map(d => {
      batch.update(d.ref, { fired: true, firedAt: now });
      return { id: d.id, ...d.data() };
    });
    await batch.commit();
    return due;
  }
  async listReminders() {
    const snap = await this.db.collection('reminders').where('fired', '==', false).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  async log(event) {
    console.log(`[agent] ${event.type}: ${JSON.stringify(event)}`);
    await this.db.collection('agent_log').add({ ...event, at: Date.now() });
  }
  async addFamilyMessage(m) {
    await this.db.collection('family_messages').add({ ...m, at: Date.now() });
  }
  async setAlert(alert) {
    await this.db.collection('alerts').add({ ...alert, at: Date.now() });
  }
  async latestAlert() {
    const snap = await this.db.collection('alerts').orderBy('at', 'desc').limit(1).get();
    return snap.empty ? null : snap.docs[0].data();
  }
  async saveHealthLog(entry) { // doc id = date_period → one record per meal
    const key = `${entry.date}_${entry.period}`;
    await this.db.collection('health_log').doc(key).set({ ...entry, at: Date.now() }, { merge: true });
    return key;
  }
  async listHealthLog(days = 7) {
    const cutoff = Date.now() - days * 86400_000;
    const snap = await this.db.collection('health_log').where('at', '>=', cutoff).orderBy('at', 'desc').get();
    return snap.docs.map(d => d.data());
  }
}

export async function createStore() {
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    try {
      const { Firestore } = await import('@google-cloud/firestore');
      const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
      // probe connectivity once so we can fall back loudly instead of failing per-request
      await db.collection('agent_log').limit(1).get();
      console.log('[store] using Firestore, project', process.env.GOOGLE_CLOUD_PROJECT);
      return new FirestoreStore(db);
    } catch (e) {
      console.warn('[store] Firestore unavailable, falling back to memory:', e.message);
    }
  }
  console.log('[store] using in-memory store (set GOOGLE_CLOUD_PROJECT for Firestore)');
  return new MemoryStore();
}
