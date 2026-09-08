import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedEmail, emailSchema, registerSchema, loginSchema, EMAIL_ALLOWED_DOMAIN_MESSAGE } from '../src/auth/auth.validators';

describe('Auth: Allowed Email Domain & Disposable Email Blocking', () => {
  describe('isAllowedEmail unit tests', () => {
    it('allows valid .com emails', () => {
      assert.equal(isAllowedEmail('user@gmail.com'), true);
      assert.equal(isAllowedEmail('john.doe@company.com'), true);
      assert.equal(isAllowedEmail('support@sub.domain.com'), true);
      assert.equal(isAllowedEmail('USER@TEST.COM'), true);
    });

    it('allows valid .com.au emails', () => {
      assert.equal(isAllowedEmail('admin@rayvice.com.au'), true);
      assert.equal(isAllowedEmail('invoices@myplanmanager.com.au'), true);
      assert.equal(isAllowedEmail('contact@service.provider.com.au'), true);
    });

    it('allows valid .net emails', () => {
      assert.equal(isAllowedEmail('network@telstra.net'), true);
      assert.equal(isAllowedEmail('user@speed.net'), true);
    });

    it('allows valid .org emails', () => {
      assert.equal(isAllowedEmail('director@charity.org'), true);
      assert.equal(isAllowedEmail('help@community.org'), true);
    });

    it('rejects other TLDs (e.g. .io, .xyz, .cc, .ru, .co, .tk)', () => {
      assert.equal(isAllowedEmail('user@startup.io'), false);
      assert.equal(isAllowedEmail('user@temp.xyz'), false);
      assert.equal(isAllowedEmail('spam@domain.cc'), false);
      assert.equal(isAllowedEmail('bot@mail.ru'), false);
      assert.equal(isAllowedEmail('tester@site.co'), false);
      assert.equal(isAllowedEmail('fake@free.tk'), false);
      assert.equal(isAllowedEmail('user@app.dev'), false);
      assert.equal(isAllowedEmail('user@domain.co.uk'), false);
    });

    it('rejects disposable / temporary email domains even if matching allowed TLDs', () => {
      assert.equal(isAllowedEmail('fake@tempmail.com'), false);
      assert.equal(isAllowedEmail('spammer@tempmail.net'), false);
      assert.equal(isAllowedEmail('throwaway@mailnull.com'), false);
      assert.equal(isAllowedEmail('disposable@10minutemail.com'), false);
      assert.equal(isAllowedEmail('bot@guerrillamail.com'), false);
      assert.equal(isAllowedEmail('test@trashmail.org'), false);
      assert.equal(isAllowedEmail('test@yopmail.com'), false);
      assert.equal(isAllowedEmail('test@temp-mail.org'), false);
      assert.equal(isAllowedEmail('test@burnermail.com'), false);
    });

    it('rejects malformed emails', () => {
      assert.equal(isAllowedEmail(''), false);
      assert.equal(isAllowedEmail('notanemail'), false);
      assert.equal(isAllowedEmail('@com'), false);
      assert.equal(isAllowedEmail('user@'), false);
      assert.equal(isAllowedEmail('user@.com'), false);
      assert.equal(isAllowedEmail('user@domain'), false);
    });
  });

  describe('Zod Schema Integration', () => {
    it('emailSchema accepts allowed emails', () => {
      const parsed = emailSchema.safeParse('valid@service.com.au');
      assert.equal(parsed.success, true);
    });

    it('emailSchema rejects disallowed TLD with appropriate error message', () => {
      const parsed = emailSchema.safeParse('user@disallowed.xyz');
      assert.equal(parsed.success, false);
      if (!parsed.success) {
        assert.equal(parsed.error.errors[0].message, EMAIL_ALLOWED_DOMAIN_MESSAGE);
      }
    });

    it('emailSchema rejects disposable email with appropriate error message', () => {
      const parsed = emailSchema.safeParse('user@mailnull.com');
      assert.equal(parsed.success, false);
      if (!parsed.success) {
        assert.equal(parsed.error.errors[0].message, EMAIL_ALLOWED_DOMAIN_MESSAGE);
      }
    });

    it('loginSchema enforces allowed domain constraint', () => {
      const validLogin = loginSchema.safeParse({
        body: { email: 'manager@rayvice.com', password: 'Password123' },
      });
      assert.equal(validLogin.success, true);

      const invalidLogin = loginSchema.safeParse({
        body: { email: 'hacker@tempmail.com', password: 'Password123' },
      });
      assert.equal(invalidLogin.success, false);
    });

    it('registerSchema enforces allowed domain constraint', () => {
      const validReg = registerSchema.safeParse({
        body: {
          businessName: 'Acme Care',
          firstName: 'John',
          lastName: 'Smith',
          email: 'john@acmecare.org',
          password: 'Password123',
        },
      });
      assert.equal(validReg.success, true);

      const invalidReg = registerSchema.safeParse({
        body: {
          businessName: 'Acme Care',
          firstName: 'John',
          lastName: 'Smith',
          email: 'john@temporary.xyz',
          password: 'Password123',
        },
      });
      assert.equal(invalidReg.success, false);
    });
  });
});
