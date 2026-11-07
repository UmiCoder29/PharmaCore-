import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { unwrapPlansResponse } from '../src/utils/planUtils.js';

describe('SubscriptionScreen Plans Response Unwrapping & Trial Behavior', () => {
  describe('Bug Reproduction (TypeError: plans.filter is not a function)', () => {
    it('fails when using un-unwrapped IPC response object because plans is not an array', () => {
      const mockIpcResponse = {
        success: true,
        data: [
          { id: '1', slug: 'trial', name: '14-Day Free Trial', priceMonthly: 0 },
          { id: '2', slug: 'starter', name: 'Starter Plan', priceMonthly: 3000 },
          { id: '3', slug: 'professional', name: 'Professional Plan', priceMonthly: 8000 }
        ]
      };

      // In the buggy implementation, unwrapPlansResponse returned mockIpcResponse directly
      const result = unwrapPlansResponse(mockIpcResponse);

      // Must return an object containing guaranteed array plans: Array
      assert.ok(result && typeof result === 'object', 'Must return result object');
      assert.ok(Array.isArray(result.plans), 'result.plans MUST be an Array');

      // The exact line that crashed SubscriptionScreen line 540:
      const upgradeOptions = result.plans.filter(p => p.slug !== 'trial');
      assert.equal(upgradeOptions.length, 2);
    });
  });

  describe('unwrapPlansResponse across all response shapes', () => {
    const samplePlans = [
      { id: '1', slug: 'trial', name: '14-Day Free Trial', priceMonthly: 0 },
      { id: '2', slug: 'starter', name: 'Starter Plan', priceMonthly: 3000 }
    ];

    it('handles standard success response shape { success: true, data: [...] }', () => {
      const response = { success: true, data: samplePlans };
      const { plans, error } = unwrapPlansResponse(response);

      assert.ok(Array.isArray(plans), 'plans must be an array');
      assert.equal(plans.length, 2);
      assert.equal(plans[0].slug, 'trial');
      assert.equal(error, null, 'error must be null on success');
    });

    it('handles failure response shape { success: false, error: ... }', () => {
      const response = { success: false, error: 'Database client not initialized.' };
      const { plans, error } = unwrapPlansResponse(response);

      assert.ok(Array.isArray(plans), 'plans must be an array even on failure');
      assert.equal(plans.length, 0, 'plans must be empty on failure');
      assert.equal(error, 'Database client not initialized.');
    });

    it('handles failure response without explicit error message with friendly default', () => {
      const response = { success: false };
      const { plans, error } = unwrapPlansResponse(response);

      assert.ok(Array.isArray(plans), 'plans must be an array');
      assert.equal(plans.length, 0);
      assert.equal(error, 'Failed to load subscription plans.');
    });

    it('handles bare array response [...]', () => {
      const response = samplePlans;
      const { plans, error } = unwrapPlansResponse(response);

      assert.ok(Array.isArray(plans), 'plans must be an array');
      assert.equal(plans.length, 2);
      assert.equal(error, null);
    });

    it('handles null response safely', () => {
      const { plans, error } = unwrapPlansResponse(null);

      assert.ok(Array.isArray(plans), 'plans must be an array');
      assert.equal(plans.length, 0);
      assert.equal(error, null);
    });

    it('handles undefined response safely', () => {
      const { plans, error } = unwrapPlansResponse(undefined);

      assert.ok(Array.isArray(plans), 'plans must be an array');
      assert.equal(plans.length, 0);
      assert.equal(error, null);
    });

    it('handles unexpected object or primitive inputs safely without crashing', () => {
      const resObj = unwrapPlansResponse({ randomKey: 123 });
      assert.ok(Array.isArray(resObj.plans));
      assert.equal(resObj.plans.length, 0);

      const resNum = unwrapPlansResponse(42);
      assert.ok(Array.isArray(resNum.plans));
      assert.equal(resNum.plans.length, 0);

      const resStr = unwrapPlansResponse('error');
      assert.ok(Array.isArray(resStr.plans));
      assert.equal(resStr.plans.length, 0);
    });
  });

  describe('Trial Pharmacy UI Behavior Verification', () => {
    const fullPlansList = [
      { id: '1', slug: 'trial', name: '14-Day Free Trial', priceMonthly: 0, maxBranches: 1, maxUsers: 3 },
      { id: '2', slug: 'starter', name: 'Starter Plan', priceMonthly: 3000, maxBranches: 1, maxUsers: 3 },
      { id: '3', slug: 'professional', name: 'Professional Plan', priceMonthly: 8000, maxBranches: 5, maxUsers: 15 },
      { id: '4', slug: 'enterprise', name: 'Enterprise Tier', priceMonthly: 20000, maxBranches: 50, maxUsers: 100 }
    ];

    it('Target Plan dropdown correctly filters out trial slug for upgrade requests', () => {
      const { plans } = unwrapPlansResponse({ success: true, data: fullPlansList });

      // In SubscriptionScreen.jsx line 540:
      const selectableUpgradePlans = plans.filter(p => p.slug !== 'trial');

      assert.equal(selectableUpgradePlans.length, 3);
      assert.deepEqual(
        selectableUpgradePlans.map(p => p.slug),
        ['starter', 'professional', 'enterprise']
      );
      assert.ok(!selectableUpgradePlans.some(p => p.slug === 'trial'), 'Trial plan must not be in upgrade dropdown');
    });

    it('Tiers grid correctly highlights the trial plan as Current for a trial pharmacy', () => {
      const { plans } = unwrapPlansResponse({ success: true, data: fullPlansList });
      const trialSubData = {
        planTier: 'trial',
        subscriptionStatus: 'trial',
        daysRemaining: 14,
        maxBranches: 1,
        maxUsers: 3
      };

      // Simulate the grid mapping in SubscriptionScreen.jsx line 620-628:
      const mappedCards = plans.map(plan => ({
        slug: plan.slug,
        name: plan.name,
        isCurrent: trialSubData?.planTier === plan.slug
      }));

      assert.equal(mappedCards.length, 4);

      const currentCard = mappedCards.find(c => c.isCurrent);
      assert.ok(currentCard, 'Must find a card marked as Current');
      assert.equal(currentCard.slug, 'trial');
      assert.equal(currentCard.name, '14-Day Free Trial');

      const nonCurrentCards = mappedCards.filter(c => !c.isCurrent);
      assert.equal(nonCurrentCards.length, 3);
      assert.deepEqual(
        nonCurrentCards.map(c => c.slug),
        ['starter', 'professional', 'enterprise']
      );
    });
  });
});

