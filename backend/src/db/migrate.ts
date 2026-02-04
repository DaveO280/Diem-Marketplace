import { initializeDatabase } from './connection';

console.log('Running database migrations...');
initializeDatabase();
console.log('Migrations complete!');
