const jwt = require('jsonwebtoken');
require('dotenv').config();

const checkAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer TOKEN"
    
    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }
    
    const authSecret = process.env.AUTH_SECRET;
    if (!authSecret) {
        return res.status(500).json({ message: 'Server configuration error' });
    }
    
    try {
        const decoded = jwt.verify(token, authSecret);
        req.user = decoded; // Add user info to request object
        next();
    } catch (err) {
        return res.status(403).json({ message: 'Invalid or expired token' });
    }
};

module.exports = { checkAuth };