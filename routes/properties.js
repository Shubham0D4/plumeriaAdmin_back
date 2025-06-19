const express = require('express');
const routes = express.Router();
const pool = require('../dbcon');
const app = express();

// Helper function to create database connection
const createConnection = async () => {
    return await pool.getConnection();
};

// Helper function to close database connection
const closeConnection = async (connection) => {
    if (connection) connection.release();
};

app.use(express.json());


// GET /admin/properties/accommodations - Fetch all accommodations
routes.get('/accommodations', async (req, res) => {
    try {
        const connection = await createConnection();
        
        // Get query parameters for filtering
        const { type, capacity, availability, search } = req.query;
        
        let query = `
            SELECT 
                id,
                type,
                title,
                description,
                price,
                capacity,
                features,
                image,
                has_ac,
                has_attached_bath,
                available_rooms,
                detailed_info,
                created_at,
                (available_rooms > 0) as available
            FROM accommodations
        `;
        
        const conditions = [];
        const params = [];
        
        // Apply filters
        if (type && type !== '') {
            conditions.push('type = ?');
            params.push(type);
        }
        
        if (capacity && capacity !== '') {
            if (capacity === '1-2') {
                conditions.push('capacity BETWEEN 1 AND 2');
            } else if (capacity === '3-4') {
                conditions.push('capacity BETWEEN 3 AND 4');
            } else if (capacity === '5+') {
                conditions.push('capacity >= 5');
            }
        }
        
        if (availability && availability !== '') {
            if (availability === 'available') {
                conditions.push('available_rooms > 0');
            } else if (availability === 'unavailable') {
                conditions.push('available_rooms = 0');
            }
        }
        
        if (search && search.trim() !== '') {
            conditions.push('(title LIKE ? OR description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY created_at DESC';
        
        const [rows] = await connection.execute(query, params);
        
        // Process the data to match frontend expectations
        const safeParse = (jsonString, defaultValue, label = 'unknown') => {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error(`❌ JSON parse error in [${label}]:`, e.message);
        console.error("🧪 Data was:", jsonString);
        return defaultValue;
    }
};

const processedRows = rows.map(row => {
    const featuresParsed = row.features ? safeParse(row.features, [], 'features') : [];
    const imageParsed = row.image ? safeParse(row.image, null, 'image') : null;
    const detailedInfoParsed = row.detailed_info ? safeParse(row.detailed_info, null, 'detailed_info') : null;

    return {
        ...row,
        available: row.available === 1,
        has_ac: row.has_ac === 1,
        has_attached_bath: row.has_attached_bath === 1,
        features: featuresParsed,
        image_url: imageParsed ? (Array.isArray(imageParsed) ? imageParsed[0] : imageParsed) : null,
        detailed_info: detailedInfoParsed,
        amenities: featuresParsed
    };
});

        
        await closeConnection(connection);
        res.json(processedRows);
    } catch (error) {
        console.error('Error fetching accommodations:', error);
        res.status(500).json({ error: 'Failed to fetch accommodations' });
    }
});

// GET /admin/properties/accommodations/:id - Fetch single accommodation
routes.get('/accommodations/:id', async (req, res) => {
    // Utility to safely parse JSON, even with emojis or corrupt data
const safeParseJSON = (input, fallback = null) => {
    try {
        if (typeof input === 'object') return input; // Already parsed
        return JSON.parse(input);
    } catch (err) {
        console.warn('⚠️ JSON parse error:', err.message, '| Input:', input);
        return fallback;
    }
};

try {
    const { id } = req.params;
    const connection = await createConnection();

    const [rows] = await connection.execute(
        `SELECT 
            *,
            (available_rooms > 0) as available
        FROM accommodations 
        WHERE id = ?`, 
        [id]
    );

    if (rows.length === 0) {
        await closeConnection(connection);
        return res.status(404).json({ error: 'Accommodation not found' });
    }

    const accommodation = rows[0];

    const processedAccommodation = {
        ...accommodation,
        available: accommodation.available === 1,
        has_ac: accommodation.has_ac === 1,
        has_attached_bath: accommodation.has_attached_bath === 1,
        features: safeParseJSON(accommodation.features, []),
        image_url: (() => {
            const img = safeParseJSON(accommodation.image, null);
            return Array.isArray(img) ? img[0] : img;
        })(),
        detailed_info: safeParseJSON(accommodation.detailed_info, {})
    };

    await closeConnection(connection);
    res.json(processedAccommodation);
} catch (error) {
    console.error('Error fetching accommodation:', error);
    res.status(500).json({ error: 'Failed to fetch accommodation' });
}

});

// POST /admin/properties/accommodations - Create new accommodation
routes.post('/accommodations', async (req, res) => {
    try {
        const {
            type,
            title,
            description,
            price,
            capacity,
            features,
            image,
            has_ac,
            has_attached_bath,
            available_rooms,
            detailed_info
        } = req.body;
        
        const connection = await createConnection();
        
        const [result] = await connection.execute(
            `INSERT INTO accommodations 
            (type, title, description, price, capacity, features, image, has_ac, has_attached_bath, available_rooms, detailed_info) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                type,
                title,
                description,
                price,
                capacity,
                JSON.stringify(features || []),
                JSON.stringify(image || []),
                has_ac || false,
                has_attached_bath || false,
                available_rooms,
                JSON.stringify(detailed_info || {})
            ]
        );
        
        await closeConnection(connection);
        res.status(201).json({ 
            message: 'Accommodation created successfully', 
            id: result.insertId 
        });
    } catch (error) {
        console.error('Error creating accommodation:', error);
        res.status(500).json({ error: 'Failed to create accommodation' });
    }
});

// PUT /admin/properties/accommodations/:id - Update accommodation
routes.put('/accommodations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            type,
            title,
            description,
            price,
            capacity,
            features,
            image,
            has_ac,
            has_attached_bath,
            available_rooms,
            detailed_info
        } = req.body;
        
        const connection = await createConnection();
        
        const [result] = await connection.execute(
            `UPDATE accommodations 
            SET type = ?, title = ?, description = ?, price = ?, capacity = ?, 
                features = ?, image = ?, has_ac = ?, has_attached_bath = ?, 
                available_rooms = ?, detailed_info = ?
            WHERE id = ?`,
            [
                type,
                title,
                description,
                price,
                capacity,
                JSON.stringify(features || []),
                JSON.stringify(image || []),
                has_ac || false,
                has_attached_bath || false,
                available_rooms,
                JSON.stringify(detailed_info || {}),
                id
            ]
        );
        
        if (result.affectedRows === 0) {
            await closeConnection(connection);
            return res.status(404).json({ error: 'Accommodation not found' });
        }
        
        await closeConnection(connection);
        res.json({ message: 'Accommodation updated successfully' });
    } catch (error) {
        console.error('Error updating accommodation:', error);
        res.status(500).json({ error: 'Failed to update accommodation' });
    }
});

// DELETE /admin/properties/accommodations/:id - Delete accommodation
routes.delete('/accommodations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const connection = await createConnection();
        
        // Check if accommodation exists and has any bookings
        const [bookingCheck] = await connection.execute(
            'SELECT COUNT(*) as count FROM bookings WHERE accommodation_id = ?',
            [id]
        );
        
        if (bookingCheck[0].count > 0) {
            await closeConnection(connection);
            return res.status(400).json({ 
                error: 'Cannot delete accommodation with existing bookings' 
            });
        }
        
        const [result] = await connection.execute(
            'DELETE FROM accommodations WHERE id = ?',
            [id]
        );
        
        if (result.affectedRows === 0) {
            await closeConnection(connection);
            return res.status(404).json({ error: 'Accommodation not found' });
        }
        
        await closeConnection(connection);
        res.json({ message: 'Accommodation deleted successfully' });
    } catch (error) {
        console.error('Error deleting accommodation:', error);
        res.status(500).json({ error: 'Failed to delete accommodation' });
    }
});

// PATCH /admin/properties/accommodations/:id/toggle-availability - Toggle availability
routes.patch('/accommodations/:id/toggle-availability', async (req, res) => {
    try {
        const { id } = req.params;
        const { available } = req.body;
        
        const connection = await createConnection();
        
        // If setting to available, set available_rooms to 1, if unavailable set to 0
        const available_rooms = available ? 1 : 0;
        
        const [result] = await connection.execute(
            'UPDATE accommodations SET available_rooms = ? WHERE id = ?',
            [available_rooms, id]
        );
        
        if (result.affectedRows === 0) {
            await closeConnection(connection);
            return res.status(404).json({ error: 'Accommodation not found' });
        }
        
        await closeConnection(connection);
        res.json({ 
            message: 'Availability updated successfully',
            available: available
        });
    } catch (error) {
        console.error('Error updating availability:', error);
        res.status(500).json({ error: 'Failed to update availability' });
    }
});

// GET /admin/properties/accommodations/stats - Get accommodation statistics
routes.get('/accommodations/stats', async (req, res) => {
    try {
        const connection = await createConnection();
        
        const [stats] = await connection.execute(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN available_rooms > 0 THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN available_rooms = 0 THEN 1 ELSE 0 END) as unavailable,
                AVG(price) as avg_price,
                MIN(price) as min_price,
                MAX(price) as max_price
            FROM accommodations
        `);
        
        await closeConnection(connection);
        res.json(stats[0]);
    } catch (error) {
        console.error('Error fetching accommodation stats:', error);
        res.status(500).json({ error: 'Failed to fetch accommodation statistics' });
    }
});

// GET /admin/properties/users
routes.get('/users', async (req, res) => {
    try {
        const connection = await createConnection();
        const [rows] = await connection.execute('SELECT id, name, email FROM users');
        await closeConnection(connection);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET /admin/properties/cities
routes.get('/cities', async (req, res) => {
    try {
        const connection = await createConnection();
        const [rows] = await connection.execute('SELECT id, name, country FROM cities WHERE active = 1');
        await closeConnection(connection);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch cities' });
    }
});

module.exports = routes;
