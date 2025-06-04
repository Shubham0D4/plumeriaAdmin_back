// routes/bookings.js
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'mysql.railway.internal',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'XuzzPuWFCRujAWxdWZTSwVBFVKdnNnJT',
  database: process.env.DB_NAME || 'railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};
// const dbConfig = {
//   host: 'localhost',
//   user: 'root',
//   password: '2005',
//   database: 'plumeria_retreat',
// };

const pool = mysql.createPool(dbConfig);

const executeQuery = async (query, params = []) => {
    try {
        const [rows] = await pool.execute(query, params);
        return rows;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
};

// GET /api/packages - Get all packages with filters
router.get('/', async (req, res) => {
    try {
        const { search, priceRange, duration, guests, active } = req.query;
        
        let query = `
            SELECT id, name, description, price, duration, max_guests, 
                   image_url as image, includes, active, created_at, updated_at
            FROM packages 
            WHERE 1=1
        `;
        const params = [];

        // Search filter
        if (search) {
            query += ` AND (name LIKE ? OR description LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        // Price range filter
        if (priceRange) {
            switch (priceRange) {
                case 'budget':
                    query += ` AND price < 20000`;
                    break;
                case 'mid':
                    query += ` AND price BETWEEN 20000 AND 50000`;
                    break;
                case 'luxury':
                    query += ` AND price > 50000`;
                    break;
            }
        }

        // Duration filter
        if (duration) {
            switch (duration) {
                case 'short':
                    query += ` AND duration BETWEEN 1 AND 2`;
                    break;
                case 'medium':
                    query += ` AND duration BETWEEN 3 AND 5`;
                    break;
                case 'long':
                    query += ` AND duration >= 6`;
                    break;
            }
        }

        // Guests filter
        if (guests) {
            switch (guests) {
                case 'couple':
                    query += ` AND max_guests = 2`;
                    break;
                case 'family':
                    query += ` AND max_guests BETWEEN 3 AND 4`;
                    break;
                case 'group':
                    query += ` AND max_guests >= 5`;
                    break;
            }
        }

        // Active filter
        if (active !== undefined) {
            query += ` AND active = ?`;
            params.push(active === 'true' ? 1 : 0);
        }

        query += ` ORDER BY created_at DESC`;

        const packages = await executeQuery(query, params);
        
        // Parse includes JSON for each package
        const formattedPackages = packages.map(pkg => ({
            ...pkg,
            includes: typeof pkg.includes === 'string' ? JSON.parse(pkg.includes) : pkg.includes || [],
            active: Boolean(pkg.active)
        }));

        res.json({
            success: true,
            data: formattedPackages,
            total: formattedPackages.length
        });
    } catch (error) {
        console.error('Error fetching packages:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching packages',
            error: error.message
        });
    }
});

// GET /api/packages/:id - Get single package
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            SELECT id, name, description, price, duration, max_guests, 
                   image_url as image, includes, active, created_at, updated_at
            FROM packages 
            WHERE id = ?
        `;
        
        const packages = await executeQuery(query, [id]);
        
        if (packages.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Package not found'
            });
        }

        const package = packages[0];
        package.includes = typeof package.includes === 'string' ? JSON.parse(package.includes) : package.includes || [];
        package.active = Boolean(package.active);

        res.json({
            success: true,
            data: package
        });
    } catch (error) {
        console.error('Error fetching package:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching package',
            error: error.message
        });
    }
});

// POST /api/packages - Create new package
router.post('/', async (req, res) => {
    try {
        const { name, description, price, duration, max_guests, image, includes, active = true } = req.body;

        // Validation
        if (!name || !price || !duration || !max_guests) {
            return res.status(400).json({
                success: false,
                message: 'Name, price, duration, and max_guests are required'
            });
        }

        const query = `
            INSERT INTO packages (name, description, price, duration, max_guests, image_url, includes, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const includesJson = JSON.stringify(includes || []);
        const result = await executeQuery(query, [
            name, description, parseFloat(price), parseInt(duration), 
            parseInt(max_guests), image, includesJson, active ? 1 : 0
        ]);

        res.status(201).json({
            success: true,
            message: 'Package created successfully',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('Error creating package:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating package',
            error: error.message
        });
    }
});

// PUT /api/packages/:id - Update package
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, duration, max_guests, image, includes, active } = req.body;

        // Check if package exists
        const existingPackage = await executeQuery('SELECT id FROM packages WHERE id = ?', [id]);
        if (existingPackage.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Package not found'
            });
        }

        const query = `
            UPDATE packages SET 
                name = COALESCE(?, name),
                description = COALESCE(?, description),
                price = COALESCE(?, price),
                duration = COALESCE(?, duration),
                max_guests = COALESCE(?, max_guests),
                image_url = COALESCE(?, image_url),
                includes = COALESCE(?, includes),
                active = COALESCE(?, active),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        const includesJson = includes ? JSON.stringify(includes) : null;
        await executeQuery(query, [
            name, description, price ? parseFloat(price) : null, 
            duration ? parseInt(duration) : null, max_guests ? parseInt(max_guests) : null,
            image, includesJson, active !== undefined ? (active ? 1 : 0) : null, id
        ]);

        res.json({
            success: true,
            message: 'Package updated successfully'
        });
    } catch (error) {
        console.error('Error updating package:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating package',
            error: error.message
        });
    }
});

// DELETE /api/packages/:id - Delete package
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if package exists
        const existingPackage = await executeQuery('SELECT id FROM packages WHERE id = ?', [id]);
        if (existingPackage.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Package not found'
            });
        }

        await executeQuery('DELETE FROM packages WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Package deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting package:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting package',
            error: error.message
        });
    }
});

// PATCH /api/packages/:id/toggle - Toggle package active status
router.patch('/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if package exists and get current status
        const existingPackage = await executeQuery('SELECT active FROM packages WHERE id = ?', [id]);
        if (existingPackage.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Package not found'
            });
        }

        const newStatus = !existingPackage[0].active;
        await executeQuery('UPDATE packages SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus ? 1 : 0, id]);

        res.json({
            success: true,
            message: `Package ${newStatus ? 'activated' : 'deactivated'} successfully`,
            data: { active: newStatus }
        });
    } catch (error) {
        console.error('Error toggling package status:', error);
        res.status(500).json({
            success: false,
            message: 'Error toggling package status',
            error: error.message
        });
    }
});

// GET /api/packages/stats/summary - Get packages statistics
router.get('/stats/summary', async (req, res) => {
    try {
        const [totalPackages] = await executeQuery('SELECT COUNT(*) as total FROM packages');
        const [activePackages] = await executeQuery('SELECT COUNT(*) as active FROM packages WHERE active = 1');
        const [avgPrice] = await executeQuery('SELECT AVG(price) as avg_price FROM packages WHERE active = 1');
        const [priceRange] = await executeQuery('SELECT MIN(price) as min_price, MAX(price) as max_price FROM packages WHERE active = 1');

        res.json({
            success: true,
            data: {
                total: totalPackages.total,
                active: activePackages.active,
                inactive: totalPackages.total - activePackages.active,
                avgPrice: Math.round(avgPrice.avg_price || 0),
                minPrice: priceRange.min_price || 0,
                maxPrice: priceRange.max_price || 0
            }
        });
    } catch (error) {
        console.error('Error fetching package stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching package statistics',
            error: error.message
        });
    }
});


module.exports = router;