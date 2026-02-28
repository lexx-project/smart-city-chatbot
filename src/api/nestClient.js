const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const nestClient = axios.create({
    baseURL: process.env.NEST_API_URL || 'http://localhost:3000/api/v1',
    timeout: 5000,
});

module.exports = nestClient;
