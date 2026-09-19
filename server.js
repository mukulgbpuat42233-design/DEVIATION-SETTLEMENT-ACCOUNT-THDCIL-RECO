import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

// In-memory store for email OTPs
const otpStore = new Map();

// API endpoint to send Email OTP
app.post('/api/send-email-otp', (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  otpStore.set(normalizedEmail, { code, expiresAt });
  console.log(`[OTP SERVICE] Generated OTP for ${normalizedEmail}: ${code} (expires in 10 mins)`);

  return res.json({
    success: true,
    message: `Security OTP has been generated for ${normalizedEmail}`,
    email: normalizedEmail,
    code, // Returned for transparent preview demonstration and fail-safe operation
    expiresIn: 600
  });
});

// API endpoint to verify Email OTP
app.post('/api/verify-email-otp', (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP code are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const record = otpStore.get(normalizedEmail);

  if (!record) {
    return res.status(400).json({ success: false, message: 'No OTP found for this email. Please request a new OTP.' });
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(normalizedEmail);
    return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new OTP.' });
  }

  if (String(otp).trim() !== String(record.code).trim()) {
    return res.status(400).json({ success: false, message: 'Incorrect OTP entered. Please check and try again.' });
  }

  // OTP verified successfully
  otpStore.delete(normalizedEmail);
  return res.json({
    success: true,
    message: 'Email OTP verified successfully.',
    email: normalizedEmail
  });
});

// API endpoint to serve Firebase config safely
app.get('/api/firebase-config', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return res.json(data);
    }
    return res.status(404).json({ error: 'firebase-applet-config.json not found' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

