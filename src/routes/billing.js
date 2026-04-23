const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../lib/supabase');
const bcrypt = require('bcrypt');

const PLANS = {
  starter: {
    priceId: process.env.STRIPE_STARTER_PRICE_ID,
    maxMemories: 10000,
    name: 'Starter'
  },
  pro: {
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    maxMemories: 999999,
    name: 'Pro'
  }
};

// Authenticate API key helper
async function authenticateKey(apiKey) {
  if (!apiKey) return null;
  const parts = apiKey.split('.');
  if (parts.length !== 2) return null;
  const prefix = parts[0];
  const { data: keyRecord, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_prefix', prefix)
    .single();
  if (error || !keyRecord) return null;
  const valid = await bcrypt.compare(apiKey, keyRecord.key_hash);
  if (!valid) return null;
  return keyRecord;
}

// POST /billing/checkout — create Stripe checkout session
router.post('/checkout', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const keyRecord = await authenticateKey(apiKey);

    if (!keyRecord) {
      return res.status(401).json({ error: 'Invalid API key.' });
    }

    const { plan } = req.body;

    if (!PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Choose starter or pro.' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: PLANS[plan].priceId,
        quantity: 1
      }],
      success_url: `${process.env.APP_URL || 'https://memoryapi.org'}?upgrade=success&plan=${plan}`,
      cancel_url: `${process.env.APP_URL || 'https://memoryapi.org'}?upgrade=cancelled`,
      metadata: {
        api_key_id: keyRecord.id,
        agent_id: keyRecord.agent_id,
        plan
      },
      customer_email: keyRecord.owner_email || undefined
    });

    res.json({
      success: true,
      checkout_url: session.url,
      session_id: session.id
    });

  } catch (err) {
    console.error('POST /billing/checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

// POST /billing/portal — customer portal for managing subscription
router.post('/portal', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const keyRecord = await authenticateKey(apiKey);

    if (!keyRecord) {
      return res.status(401).json({ error: 'Invalid API key.' });
    }

    if (!keyRecord.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: keyRecord.stripe_customer_id,
      return_url: process.env.APP_URL || 'https://memoryapi.org'
    });

    res.json({ success: true, portal_url: session.url });

  } catch (err) {
    console.error('POST /billing/portal error:', err);
    res.status(500).json({ error: 'Failed to create portal session.' });
  }
});

// GET /billing/status — get current plan status
router.get('/status', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const keyRecord = await authenticateKey(apiKey);

    if (!keyRecord) {
      return res.status(401).json({ error: 'Invalid API key.' });
    }

    res.json({
      success: true,
      plan: keyRecord.plan,
      memory_count: keyRecord.memory_count,
      max_memories: keyRecord.max_memories,
      memories_remaining: keyRecord.max_memories - keyRecord.memory_count
    });

  } catch (err) {
    console.error('GET /billing/status error:', err);
    res.status(500).json({ error: 'Failed to get billing status.' });
  }
});

// POST /billing/webhook — Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { api_key_id, plan } = session.metadata;

        if (api_key_id && plan && PLANS[plan]) {
          await supabase
            .from('api_keys')
            .update({
              plan,
              max_memories: PLANS[plan].maxMemories,
              stripe_customer_id: session.customer
            })
            .eq('id', api_key_id);

          console.log(`✅ Upgraded key ${api_key_id} to ${plan}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        // Downgrade to free when subscription cancelled
        const { data: keys } = await supabase
          .from('api_keys')
          .select('id')
          .eq('stripe_customer_id', subscription.customer);

        if (keys && keys.length > 0) {
          await supabase
            .from('api_keys')
            .update({ plan: 'free', max_memories: 100 })
            .eq('stripe_customer_id', subscription.customer);

          console.log(`⬇️ Downgraded customer ${subscription.customer} to free`);
        }
        break;
      }
    }

    res.json({ received: true });

  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

module.exports = router;
