
import express from 'express';
import pkg from 'pg';
import Stripe from 'stripe';

const router = express.Router();
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/create-checkout-session', async (req,res)=>{
  try{
    const { email } = req.body;
    const session = await stripe.checkout.sessions.create({
      mode:'payment',
      payment_method_types:['card'],
      line_items:[{
        price_data:{
          currency:'brl',
          product_data:{ name:'Licença Controle Financeiro' },
          unit_amount: 990
        },
        quantity:1
      }],
      customer_email: email,
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL
    });
    res.json({ url: session.url });
  }catch(err){
    console.error(err);
    res.status(500).json({error:'stripe_error'});
  }
});

router.post('/validate-license', async (req,res)=>{
  const { email, license_key } = req.body;
  try{
    const q = await pool.query(
      "SELECT * FROM user_licenses WHERE license_key=$1",
      [license_key]
    );
    if(q.rows.length>0) res.json({valid:true});
    else res.json({valid:false});
  }catch(e){
    console.error(e);
    res.status(500).json({error:'db_error'});
  }
});

export default router;
