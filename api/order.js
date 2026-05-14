const admin = require('firebase-admin');

// 1. Wake up the Firebase Backend securely using Vercel Vault keys
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // We replace \\n with \n because Vercel sometimes scrambles the formatting
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
        databaseURL: "https://smm-panel-c1821-default-rtdb.firebaseio.com"
    });
}

const db = admin.database();

export default async function handler(req, res) {
    // 2. Security Headers (Allow your frontend to talk to this backend)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Hack attempt blocked. Method not allowed.' });
    }

    try {
        // 3. Receive the order request from the user's browser
        const { uid, srvId, link, qty } = req.body;

        if (!uid || !srvId || !link || !qty || qty <= 0) {
            return res.status(400).json({ error: 'Missing or invalid fields' });
        }

        // 4. FETCH REAL PRICE FROM DATABASE (Hackers cannot fake this)
        const serviceSnap = await db.ref(`services/${srvId}`).once('value');
        if (!serviceSnap.exists()) return res.status(400).json({ error: 'Service not found' });
        
        const service = serviceSnap.val();
        if (qty < service.min || qty > service.max) {
            return res.status(400).json({ error: `Quantity limits: ${service.min} - ${service.max}` });
        }

        // Server-side Math: 100% Secure
        const baseCharge = Number(((service.price / 1000) * qty).toFixed(2));

        // 5. ATOMIC TRANSACTION: Check balance and deduct at the exact same millisecond
        const userRef = db.ref(`users/${uid}/balance`);
        const transactionResult = await userRef.transaction((currentBalance) => {
            if (currentBalance === null) return 0; 
            if (currentBalance >= baseCharge) {
                return Number((currentBalance - baseCharge).toFixed(2)); // Success: Deduct money
            } else {
                return; // Fail: Abort transaction
            }
        });

        if (!transactionResult.committed) {
            return res.status(400).json({ error: 'Insufficient funds. Nice try!' });
        }

        // 6. Money is safely deducted. Now create the actual order.
        const orderId = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);
        await db.ref(`orders/${orderId}`).set({
            userId: uid,
            serviceId: srvId,
            serviceName: service.name,
            link: link,
            quantity: qty,
            charge: baseCharge,
            status: 'Pending',
            timestamp: Date.now()
        });

        return res.status(200).json({ success: true, message: 'Order Placed Successfully!' });

    } catch (error) {
        console.error("Backend Error:", error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
