import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import {stripe} from '@/libs/stripe';

import { upsertProductoRecord, upsertPriceRecord, manageSubscriptionStatusChange } from '@/libs/supabaseAdmin';

const relevantEvents = new Set([
    'product.created',
    'product.updated',
    'price.created',
    'price.updated',
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
]);

export async function POST(request: Request) {
    const body = await request.text();
    const sig = headers().get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event: Stripe.Event;

    try{
        if(!webhookSecret || !sig){
            throw new Error('Missing Stripe webhook secret or signature');
        }
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    }catch(err: any){
        return new NextResponse(`Webhook error: ${err.message}`, {status: 400});
    }
    
    if(relevantEvents.has(event.type)){
        try{
            switch(event.type){
                case 'product.created':
                case 'product.updated':
                    await upsertProductoRecord(event.data.object as Stripe.Product);
                    break;
                case 'price.created':
                case 'price.updated':
                    await upsertPriceRecord(event.data.object as Stripe.Price);
                    break;
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                case 'customer.subscription.deleted':
                    const subscription = event.data.object as Stripe.Subscription;
                    await manageSubscriptionStatusChange(subscription.id, subscription.customer as string, event.type === 'customer.subscription.created');
                    break;
                case 'checkout.session.completed':
                    const checkoutSession = event.data.object as Stripe.Checkout.Session;
                    if(checkoutSession.mode === 'subscription'){
                        const subscriptionId = checkoutSession.subscription as string;
                        await manageSubscriptionStatusChange(subscriptionId as string, checkoutSession.customer as string, true);
                    }
                    break;
                default:
                    throw new Error(`Unhandled relevant event type: ${event.type}`);
            }
        }catch(err: any){
            return new NextResponse(`Webhook error: ${err.message}`, {status: 400});
        }
    }

    return NextResponse.json({received: true}, {status: 200});
}  