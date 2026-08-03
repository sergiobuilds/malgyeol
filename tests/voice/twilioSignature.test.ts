import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTwilioSignature, verifyTwilioSignature } from '../../src/voice/twilioSignature.ts';
import { confirmationTwiml, incomingTwiml } from '../../src/voice/twiml.ts';

test('Twilio signature verification binds URL and sorted form fields', () => {
  const url = 'https://demo.example/voice/incoming';
  const params = { From: '+15551234567', CallSid: 'CA123' };
  const signature = computeTwilioSignature('secret', url, params);
  assert.equal(verifyTwilioSignature('secret', signature, url, params), true);
  assert.equal(verifyTwilioSignature('secret', signature, `${url}?tampered=1`, params), false);
});

test('TwiML records one request turn and gathers one-time DTMF confirmation', () => {
  assert.match(incomingTwiml('https://demo.example/voice/recorded'), /<Record/);
  const xml = confirmationTwiml('승인된 기립 보조기 1개, 총 380000원', 'https://demo.example/voice/confirm');
  assert.match(xml, /input="dtmf"/);
  assert.match(xml, /numDigits="1"/);
  assert.match(xml, /380000/);
});
