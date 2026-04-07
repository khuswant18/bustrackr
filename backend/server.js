require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY || '';
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID || '';
const MSG91_EMAIL_TEMPLATE_ID = process.env.MSG91_EMAIL_TEMPLATE_ID || '';
const APP_JWT_SECRET = process.env.APP_JWT_SECRET || '';
const APP_JWT_EXPIRES_IN = process.env.APP_JWT_EXPIRES_IN || '1d';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

if (!MSG91_AUTH_KEY || !APP_JWT_SECRET) {
  process.stderr.write('Missing required env vars: MSG91_AUTH_KEY and APP_JWT_SECRET\n');
}

app.use(helmet());
app.use(
  cors({
    origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));

const sessions = new Map();

const PHONE_REGEX = /^\d{10,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_REGEX = /^\d{4,8}$/;

const isPhone = (value) => PHONE_REGEX.test(String(value || '').trim());
const isEmail = (value) => EMAIL_REGEX.test(String(value || '').trim().toLowerCase());

const normalizeIdentifier = (identifier) => String(identifier || '').trim();

const validateIdentifier = (identifier) => {
  const id = normalizeIdentifier(identifier);
  if (!id) return { ok: false, error: 'Identifier is required.' };
  if (!isPhone(id) && !isEmail(id)) {
    return { ok: false, error: 'Identifier must be a mobile number or email.' };
  }
  return { ok: true, identifier: id, type: isPhone(id) ? 'mobile' : 'email' };
};

const validateOtp = (otp) => {
  const value = String(otp || '').trim();
  if (!OTP_REGEX.test(value)) {
    return { ok: false, error: 'OTP must be between 4 and 8 digits.' };
  }
  return { ok: true, otp: value };
};

const makeMsg91Request = async (url, options) => {
  const response = await fetch(url, options);
  const text = await response.text();

  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  return { ok: response.ok, status: response.status, payload };
};

const generateAppToken = (identifier, channel) => {
  return jwt.sign(
    {
      sub: identifier,
      channel,
      provider: 'msg91',
    },
    APP_JWT_SECRET,
    { expiresIn: APP_JWT_EXPIRES_IN }
  );
};

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/send-otp', async (req, res) => {
  try {
    const validation = validateIdentifier(req.body?.identifier);
    if (!validation.ok) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const { identifier, type } = validation;

    if (!MSG91_AUTH_KEY) {
      return res.status(500).json({ success: false, error: 'MSG91 is not configured.' });
    }

    if (type === 'mobile' && !MSG91_TEMPLATE_ID) {
      return res.status(500).json({ success: false, error: 'MSG91 mobile template is not configured.' });
    }

    if (type === 'email' && !MSG91_EMAIL_TEMPLATE_ID) {
      return res.status(500).json({ success: false, error: 'MSG91 email template is not configured.' });
    }

    let url;
    let method;
    let headers = { authkey: MSG91_AUTH_KEY };

    if (type === 'mobile') {
      const qs = new URLSearchParams({
        template_id: MSG91_TEMPLATE_ID,
        mobile: identifier,
      });
      url = `https://control.msg91.com/api/v5/otp?${qs.toString()}`;
      method = 'POST';
    } else {
      url = 'https://control.msg91.com/api/v5/email/otp';
      method = 'POST';
      headers['Content-Type'] = 'application/json';
    }

    const requestOptions =
      type === 'email'
        ? {
            method,
            headers,
            body: JSON.stringify({
              template_id: MSG91_EMAIL_TEMPLATE_ID,
              email: identifier,
            }),
          }
        : {
            method,
            headers,
          };

    const { ok, status, payload } = await makeMsg91Request(url, requestOptions);

    if (!ok) {
      return res.status(status || 400).json({
        success: false,
        error: payload?.message || 'Failed to send OTP.',
        details: payload,
      });
    }

    const requestId = payload?.request_id || payload?.requestId || payload?.req_id || '';
    sessions.set(requestId || identifier, {
      identifier,
      type,
      createdAt: Date.now(),
    });

    return res.status(200).json({
      success: true,
      message: payload?.message || 'OTP sent successfully.',
      requestId,
      channel: type,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Unexpected error while sending OTP.' });
  }
});

app.post('/verify-otp', async (req, res) => {
  try {
    const identifierCheck = validateIdentifier(req.body?.identifier);
    if (!identifierCheck.ok) {
      return res.status(400).json({ success: false, error: identifierCheck.error });
    }

    const otpCheck = validateOtp(req.body?.otp);
    if (!otpCheck.ok) {
      return res.status(400).json({ success: false, error: otpCheck.error });
    }

    const requestId = String(req.body?.requestId || '').trim();
    const { identifier, type } = identifierCheck;

    if (!MSG91_AUTH_KEY) {
      return res.status(500).json({ success: false, error: 'MSG91 is not configured.' });
    }

    let url;
    let options;

    if (type === 'mobile') {
      const qs = new URLSearchParams({
        mobile: identifier,
        otp: otpCheck.otp,
      });
      url = `https://control.msg91.com/api/v5/otp/verify?${qs.toString()}`;
      options = {
        method: 'GET',
        headers: {
          authkey: MSG91_AUTH_KEY,
        },
      };
    } else {
      url = 'https://control.msg91.com/api/v5/email/otp/verify';
      options = {
        method: 'POST',
        headers: {
          authkey: MSG91_AUTH_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: identifier,
          otp: otpCheck.otp,
        }),
      };
    }

    const { ok, status, payload } = await makeMsg91Request(url, options);

    if (!ok) {
      return res.status(status || 400).json({
        success: false,
        error: payload?.message || 'OTP verification failed.',
        details: payload,
      });
    }

    const message = String(payload?.message || '').toLowerCase();
    const apiType = String(payload?.type || '').toLowerCase();
    const verified = apiType === 'success' || message.includes('verified') || payload?.verified === true;

    if (!verified) {
      return res.status(401).json({ success: false, error: 'Invalid OTP.' });
    }

    const accessToken =
      payload?.accessToken ||
      payload?.access_token ||
      payload?.['access-token'] ||
      payload?.token ||
      '';

    const appToken = generateAppToken(identifier, type);

    const sessionKey = requestId || identifier;
    sessions.set(sessionKey, {
      identifier,
      type,
      verifiedAt: Date.now(),
      accessToken,
      appToken,
    });

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully.',
      requestId,
      accessToken,
      appToken,
      user: {
        identifier,
        channel: type,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Unexpected error while verifying OTP.' });
  }
});

app.post('/verify-token', async (req, res) => {
  try {
    const accessToken = String(req.body?.accessToken || '').trim();

    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Access token is required.' });
    }

    if (!MSG91_AUTH_KEY) {
      return res.status(500).json({ success: false, error: 'MSG91 is not configured.' });
    }

    const { ok, status, payload } = await makeMsg91Request(
      'https://control.msg91.com/api/v5/widget/verifyAccessToken',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authkey: MSG91_AUTH_KEY,
          'access-token': accessToken,
        }),
      }
    );

    if (!ok) {
      return res.status(status || 401).json({
        success: false,
        error: payload?.message || 'Access token verification failed.',
        details: payload,
      });
    }

    const msg = String(payload?.message || '').toLowerCase();
    const type = String(payload?.type || '').toLowerCase();
    const verified = type === 'success' || msg.includes('verified') || payload?.verified === true;

    if (!verified) {
      return res.status(401).json({ success: false, error: 'Invalid access token.', details: payload });
    }

    return res.status(200).json({ success: true, message: 'Access token verified.', data: payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Unexpected error while verifying token.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

app.listen(PORT, () => {
  process.stdout.write(`OTP server listening on port ${PORT}\n`);
});