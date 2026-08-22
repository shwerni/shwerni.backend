const { io } = require('socket.io-client');

const socket = io(
  'http://shwerni-backend-alb-1887263739.eu-central-1.elb.amazonaws.com',
  {
    auth: { token: 'paste-the-token-here' },
  },
);

socket.on('connect', () => console.log('connected:', socket.id));
socket.on('connect_error', (err) =>
  console.log('connection rejected:', err.message),
);
socket.on('disconnect', (reason) => console.log('disconnected:', reason));
