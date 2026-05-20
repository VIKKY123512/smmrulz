const admin = require('firebase-admin');

// 1. Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
        }),
        databaseURL: "https://smm-panel-c1821-default-rtdb.firebaseio.com"
    });
}
const db = admin.database();

// 2. THE BULLETPROOF CORS WRAPPER
const allowCors = (fn) => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allows your frontend to connect
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Instantly approve the browser's preflight security check
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return await fn(req, res);
};

// 3. YOUR ORDER LOGIC
const handler = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const { uid, srvId, link, qty } = req.body;
        if (!uid || !srvId || !link || !qty || qty <= 0) return res.status(400).json({ error: 'Missing fields' });

        const serviceSnap = await db.ref(`services/${srvId}`).once('value');
        if (!serviceSnap.exists()) return res.status(400).json({ error: 'Service not found' });

        const service = serviceSnap.val();
        if (qty < service.min || qty > service.max) return res.status(400).json({ error: 'Invalid quantity' });

        const baseCharge = Number(((service.price / 1000) * qty).toFixed(2));
        const userRef = db.ref(`users/${uid}/balance`);
        
        const transactionResult = await userRef.transaction((currentBalance) => {
            if (currentBalance === null) return 0;
            if (currentBalance >= baseCharge) return Number((currentBalance - baseCharge).toFixed(2));
            return; // Abort if not enough funds
        });

        if (!transactionResult.committed) return res.status(400).json({ error: 'Insufficient funds' });

        const orderId = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);
        await db.ref(`orders/${orderId}`).set({
            userId: uid, serviceId: srvId, serviceName: service.name, link: link, quantity: qty, charge: baseCharge, status: 'Pending', timestamp: Date.now()
        });

        return res.status(200).json({ success: true, message: 'Order Placed' });

    } catch (error) {
        console.error("Backend Error:", error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

export default allowCors(handler);
