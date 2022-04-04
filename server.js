const fs = require('fs');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const parseLog = require('./logParser');
const app = express();
const port = 8000;

const _token = fs.readFileSync('token', 'UTF-8').trim();

app.use(cors());
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

app.get('/version', async (req, res) => {
    return res.json({
        success: true,
        version: '1.0.0',
    });
});

app.get('/log', async (req, res) => {
    res.type('text/plain');
    res.send(fs.readFileSync('server.log', 'UTF-8'));
});

app.post('/automation', async (req, res) => {
    const code = req.body.code;
    const data = req.body.data;
    const token = req.body.token;

    if(!token || _token !== token.trim()) {
        return res.json({
            success: false,
            message: 'Invalid token',
        });
    }

    let $data = {};
    try {
        $data = JSON.parse(data);
    }
    catch(e) {
        console.error(e);
        return res.json({
            success: false,
            message: e.message,
        });
    }

    try {
        const result = await eval(code);
        return res.json({
            success: true,
            result,
        });
    }
    catch(e) {
        console.error(e);
        return res.json({
            success: false,
            message: e.message,
        });
    }
});

app.listen(port, () => {
    console.log(`Tiny Server listening at http://localhost:${port}`);
});
