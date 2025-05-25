const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();
const { body, validationResult } = require('express-validator');
const fs = require('fs');       

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'plumeria_retreat'
};

// Create database connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Database connected successfully');
    connection.release();
  } catch (error) {
    console.error('Database connection failed:', error);
  }
}

// Helper function to format dates
const formatDate = (date) => {
  if (!date) return null;
  return new Date(date).toISOString().split('T')[0];
};

// Helper function to calculate payment status
const calculatePaymentStatus = (totalAmount, paidAmount) => {
  const total = parseFloat(totalAmount);
  const paid = parseFloat(paidAmount || 0);
  
  if (paid === 0) return 'Unpaid';
  if (paid >= total) return 'Paid';
  return 'Partial';
};

// Initialize uploads directory
const uploadsDir = 'uploads/accommodations';
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/accommodations';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'accommodation-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// ACCOMMODATIONS ROUTES

// POST /admin/accommodations/upload - Upload an image for accommodations
app.post('/admin/accommodations/upload', upload.single('image'), async (req, res) => {
  try {
    let imageUrl;
    
    if (req.file) {
      // Handle file upload
      imageUrl = `/uploads/accommodations/${req.file.filename}`;
    } else if (req.body.imageUrl) {
      // Handle URL upload
      imageUrl = req.body.imageUrl;
    } else {
      return res.status(400).json({ error: 'No file or URL provided' });
    }

    // Save to gallery_images table
    const [result] = await pool.execute(
      `INSERT INTO gallery_images 
       (title, category, image_url, alt_text, description) 
       VALUES (?, ?, ?, ?, ?)`,
      [
        req.body.title || 'Accommodation Image',
        'accommodation',
        imageUrl,
        req.body.alt_text || 'Accommodation Image',
        req.body.description || ''
      ]
    );

    res.json({ 
      imageUrl,
      id: result.insertId,
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// GET /admin/accommodations - Get all accommodations
app.get('/admin/accommodations', async (req, res) => {
  try {
    const { type, available, search, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        id,
        title as name,
        description,
        price,
        available_rooms,
        amenities,
        image_url,
        available,
        created_at,
        updated_at
      FROM accommodations
    `;
    
    const [rows] = await pool.execute(query);
    
    console.log('Accommodations fetched:', rows.length);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching accommodations:', error);
    res.status(500).json({ error: 'Failed to fetch accommodations' });
  }
});

// GET /admin/accommodations/:id - Get single accommodation
app.get('/admin/accommodations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT 
        id,
        title as name,
        description,
        price,
        available_rooms,
        amenities,
        image_url,
        available,
        created_at,
        updated_at
      FROM accommodations WHERE id = ?`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Accommodation not found' });
    }
    
    const row = rows[0];
    let amenitiesData = {};
    try {
      amenitiesData = row.amenities ? JSON.parse(row.amenities) : {};
    } catch (e) {
      console.error('Error parsing amenities:', e);
    }
    
    const accommodation = {
      id: row.id,
      name: row.name,
      description: row.description,
      type: amenitiesData.type || '',
      capacity: amenitiesData.capacity || 2,
      bedrooms: amenitiesData.bedrooms || 1,
      bathrooms: amenitiesData.bathrooms || 1,
      size: amenitiesData.size || 0,
      price: parseFloat(row.price),
      features: amenitiesData.features || [],
      images: amenitiesData.images || (row.image_url ? [row.image_url] : []),
      available: Boolean(row.available),
      available_rooms: row.available_rooms
    };
    
    res.json(accommodation);
  } catch (error) {
    console.error('Error fetching accommodation:', error);
    res.status(500).json({ error: 'Failed to fetch accommodation' });
  }
});

// POST /admin/accommodations - Create new accommodation
app.post('/admin/accommodations', async (req, res) => {
  try {
    const {
      name,
      description,
      type,
      capacity = 2,
      bedrooms = 1,
      bathrooms = 1,
      size = 0,
      price,
      features = [],
      images = [],
      available = true
    } = req.body;
    
    // Validate required fields
    if (!name || !description || !type || !price) {
      return res.status(400).json({ 
        error: 'Name, description, type, and price are required' 
      });
    }
    
    if (price <= 0) {
      return res.status(400).json({ error: 'Price must be greater than 0' });
    }
    
    if (images.length === 0) {
      return res.status(400).json({ error: 'At least one image is required' });
    }
    
    // Prepare amenities JSON
    const amenitiesData = {
      type,
      capacity: parseInt(capacity),
      bedrooms: parseInt(bedrooms),
      bathrooms: parseInt(bathrooms),
      size: parseInt(size),
      features: Array.isArray(features) ? features : [],
      images: Array.isArray(images) ? images : []
    };
    
    const [result] = await pool.execute(
      `INSERT INTO accommodations 
       (title, description, price, available_rooms, amenities, image_url, available) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description,
        parseFloat(price),
        10, // default available rooms
        JSON.stringify(amenitiesData),
        images[0] || null, // first image as main image
        available ? 1 : 0
      ]
    );
    
    // Fetch the newly created accommodation
    const [newAccommodation] = await pool.execute(
      `SELECT 
        id,
        title as name,
        description,
        price,
        available_rooms,
        amenities,
        image_url,
        available
      FROM accommodations WHERE id = ?`,
      [result.insertId]
    );
    
    const row = newAccommodation[0];
    const returnData = {
      id: row.id,
      name: row.name,
      description: row.description,
      type: amenitiesData.type,
      capacity: amenitiesData.capacity,
      bedrooms: amenitiesData.bedrooms,
      bathrooms: amenitiesData.bathrooms,
      size: amenitiesData.size,
      price: parseFloat(row.price),
      features: amenitiesData.features,
      images: amenitiesData.images,
      available: Boolean(row.available),
      available_rooms: row.available_rooms
    };
    
    res.status(201).json(returnData);
  } catch (error) {
    console.error('Error creating accommodation:', error);
    res.status(500).json({ error: 'Failed to create accommodation' });
  }
});

// PUT /admin/accommodations/:id - Update accommodation
app.put('/admin/accommodations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      type,
      capacity,
      bedrooms,
      bathrooms,
      size,
      price,
      features,
      images,
      available
    } = req.body;
    
    // Check if accommodation exists
    const [existing] = await pool.execute(
      'SELECT * FROM accommodations WHERE id = ?',
      [id]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Accommodation not found' });
    }
    
    // Validate required fields if provided
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    
    if (price !== undefined && price <= 0) {
      return res.status(400).json({ error: 'Price must be greater than 0' });
    }
    
    if (images !== undefined && images.length === 0) {
      return res.status(400).json({ error: 'At least one image is required' });
    }
    
    // Get current amenities data
    let currentAmenities = {};
    try {
      currentAmenities = existing[0].amenities ? JSON.parse(existing[0].amenities) : {};
    } catch (e) {
      console.error('Error parsing current amenities:', e);
    }
    
    // Prepare updated amenities
    const updatedAmenities = {
      ...currentAmenities,
      ...(type !== undefined && { type }),
      ...(capacity !== undefined && { capacity: parseInt(capacity) }),
      ...(bedrooms !== undefined && { bedrooms: parseInt(bedrooms) }),
      ...(bathrooms !== undefined && { bathrooms: parseInt(bathrooms) }),
      ...(size !== undefined && { size: parseInt(size) }),
      ...(features !== undefined && { features: Array.isArray(features) ? features : [] }),
      ...(images !== undefined && { images: Array.isArray(images) ? images : [] })
    };
    
    // Prepare update query
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('title = ?');
      params.push(name);
    }
    
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    
    if (price !== undefined) {
      updates.push('price = ?');
      params.push(parseFloat(price));
    }
    
    if (available !== undefined) {
      updates.push('available = ?');
      params.push(available ? 1 : 0);
    }
    
    // Always update amenities if any accommodation details changed
    if (type !== undefined || capacity !== undefined || bedrooms !== undefined || 
        bathrooms !== undefined || size !== undefined || features !== undefined || 
        images !== undefined) {
      updates.push('amenities = ?');
      params.push(JSON.stringify(updatedAmenities));
      
      // Update main image if images changed
      if (images !== undefined && images.length > 0) {
        updates.push('image_url = ?');
        params.push(images[0]);
      }
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    
    await pool.execute(
      `UPDATE accommodations SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    // Fetch updated accommodation
    const [updated] = await pool.execute(
      `SELECT 
        id,
        title as name,
        description,
        price,
        available_rooms,
        amenities,
        image_url,
        available
      FROM accommodations WHERE id = ?`,
      [id]
    );
    
    const row = updated[0];
    let amenitiesData = {};
    try {
      amenitiesData = row.amenities ? JSON.parse(row.amenities) : {};
    } catch (e) {
      console.error('Error parsing amenities:', e);
    }
    
    const returnData = {
      id: row.id,
      name: row.name,
      description: row.description,
      type: amenitiesData.type || '',
      capacity: amenitiesData.capacity || 2,
      bedrooms: amenitiesData.bedrooms || 1,
      bathrooms: amenitiesData.bathrooms || 1,
      size: amenitiesData.size || 0,
      price: parseFloat(row.price),
      features: amenitiesData.features || [],
      images: amenitiesData.images || [],
      available: Boolean(row.available),
      available_rooms: row.available_rooms
    };
    
    res.json(returnData);
  } catch (error) {
    console.error('Error updating accommodation:', error);
    res.status(500).json({ error: 'Failed to update accommodation' });
  }
});

// DELETE /admin/accommodations/:id - Delete accommodation
app.delete('/admin/accommodations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if accommodation has any bookings
    const [bookings] = await pool.execute(
      'SELECT COUNT(*) as count FROM bookings WHERE accommodation_id = ? AND status IN ("pending", "confirmed")',
      [id]
    );
    
    if (bookings[0].count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete accommodation with active bookings' 
      });
    }
    
    const [result] = await pool.execute(
      'DELETE FROM accommodations WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Accommodation not found' });
    }
    
    res.json({ message: 'Accommodation deleted successfully' });
  } catch (error) {
    console.error('Error deleting accommodation:', error);
    res.status(500).json({ error: 'Failed to delete accommodation' });
  }
});

// PATCH /admin/accommodations/:id/toggle-availability - Toggle availability
app.patch('/admin/accommodations/:id/toggle-availability', async (req, res) => {
  try {
    const { id } = req.params;
    const { available } = req.body;
    
    const [result] = await pool.execute(
      'UPDATE accommodations SET available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [available ? 1 : 0, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Accommodation not found' });
    }
    const limit = 50;
const offset = 10;

const [updated] = await pool.execute(
  `SELECT 
     id, title as name, description, price, available_rooms, 
     amenities, image_url, available, created_at, updated_at
   FROM accommodations`
);
    
    const row = updated[0];
    let amenitiesData = {};
    try {
      amenitiesData = row.amenities ? JSON.parse(row.amenities) : {};
    } catch (e) {
      console.error('Error parsing amenities:', e);
    }
    
    const returnData = {
      id: row.id,
      name: row.name,
      description: row.description,
      type: amenitiesData.type || '',
      capacity: amenitiesData.capacity || 2,
      bedrooms: amenitiesData.bedrooms || 1,
      bathrooms: amenitiesData.bathrooms || 1,
      size: amenitiesData.size || 0,
      price: parseFloat(row.price),
      features: amenitiesData.features || [],
      images: amenitiesData.images || [],
      available: Boolean(row.available),
      available_rooms: row.available_rooms
    };
    
    res.json(returnData);
  } catch (error) {
    console.error('Error toggling availability:', error);
    res.status(500).json({ error: 'Failed to update availability' });
  }
});

// GET /admin/accommodations/:id/bookings - Get bookings for specific accommodation
app.get('/admin/accommodations/:id/bookings', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, start_date, end_date } = req.query;
    
    let query = `
      SELECT b.*, mp.title as meal_plan_title 
      FROM bookings b
      LEFT JOIN meal_plans mp ON b.meal_plan_id = mp.id
      WHERE b.accommodation_id = ?
    `;
    const params = [id];
    
    if (status) {
      query += ' AND b.status = ?';
      params.push(status);
    }
    
    if (start_date && end_date) {
      query += ' AND (b.check_in_date <= ? AND b.check_out_date >= ?)';
      params.push(end_date, start_date);
    }
    
    query += ' ORDER BY b.check_in_date DESC';
    
    const [bookings] = await pool.execute(query, params);
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching accommodation bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// GET /admin/accommodations/stats - Get accommodation statistics
app.get('/admin/accommodations/stats', async (req, res) => {
  try {
    // Total accommodations
    const [totalResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM accommodations'
    );
    
    // Available accommodations
    const [availableResult] = await pool.execute(
      'SELECT COUNT(*) as available FROM accommodations WHERE available = 1'
    );
    
    // Occupied accommodations (have active bookings)
    const [occupiedResult] = await pool.execute(`
      SELECT COUNT(DISTINCT accommodation_id) as occupied 
      FROM bookings 
      WHERE status = 'confirmed' 
      AND check_in_date <= CURDATE() 
      AND check_out_date >= CURDATE()
    `);
    
    // Revenue this month from accommodations
    const [revenueResult] = await pool.execute(`
      SELECT SUM(total_amount) as monthly_revenue 
      FROM bookings 
      WHERE status IN ('confirmed', 'completed')
      AND MONTH(created_at) = MONTH(CURDATE())
      AND YEAR(created_at) = YEAR(CURDATE())
    `);
    
    // Popular accommodation types
    const [typesResult] = await pool.execute(`
      SELECT 
        JSON_UNQUOTE(JSON_EXTRACT(amenities, '$.type')) as type,
        COUNT(*) as count
      FROM accommodations 
      WHERE amenities IS NOT NULL
      AND JSON_UNQUOTE(JSON_EXTRACT(amenities, '$.type')) IS NOT NULL
      GROUP BY JSON_UNQUOTE(JSON_EXTRACT(amenities, '$.type'))
      ORDER BY count DESC
    `);
    
    res.json({
      total: totalResult[0].total,
      available: availableResult[0].available,
      occupied: occupiedResult[0].occupied,
      unavailable: totalResult[0].total - availableResult[0].available,
      monthly_revenue: revenueResult[0].monthly_revenue || 0,
      popular_types: typesResult
    });
  } catch (error) {
    console.error('Error fetching accommodation stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ADDITIONAL UTILITY ROUTES

// GET /admin/meal-plans - Get all meal plans (for accommodation form)
app.get('/admin/meal-plans', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM meal_plans WHERE available = 1 ORDER BY price ASC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching meal plans:', error);
    res.status(500).json({ error: 'Failed to fetch meal plans' });
  }
});

// GET /admin/activities - Get all activities (for accommodation packages)
app.get('/admin/activities', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM activities WHERE available = 1 ORDER BY price ASC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});


// Configure multer for gallery image uploads
const galleryStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Get category from form-data, fallback to 'uncategorized'
    let category = req.body.category || 'uncategorized';
    // Sanitize category to avoid path traversal
    category = category.replace(/[^a-zA-Z0-9_-]/g, '');
    const uploadsDir = `uploads/gallery/${category}`;
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'gallery-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const galleryUpload = multer({ 
  storage: galleryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit for gallery images
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// GALLERY ROUTES

// GET /admin/gallery - Get all gallery images
app.get('/admin/gallery', async (req, res) => {
  try {
    const { category, search, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        id,
        title,
        category,
        image_url,
        alt_text,
        description,
        sort_order,
        active,
        created_at,
        updated_at
      FROM gallery_images
      WHERE active = 1
    `;
    
    const params = [];
    
    if (category && category !== 'all') {
      query += ` AND category = "${category}"`;
    }
    
    if (search) {
      query += ' AND (title LIKE ? OR description LIKE ? OR alt_text LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    params.push(parseInt(limit), parseInt(offset));
    
    const [rows] = await pool.execute(query, params);
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM gallery_images WHERE active = 1';
    const countParams = [];
    
    if (category && category !== 'all') {
      countQuery += ' AND category = ?';
      countParams.push(category);
    }
    
    if (search) {
      countQuery += ' AND (title LIKE ? OR description LIKE ? OR alt_text LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }
    
    const [countResult] = await pool.execute(countQuery, countParams);
    
    console.log('Gallery images fetched:', rows.length);
    console.log('Total gallery images:', countResult);
    
    res.json({
      images: rows,
      total: countResult[0].total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching gallery images:', error);
    res.status(500).json({ error: 'Failed to fetch gallery images' });
  }
});

// GET /admin/gallery/:id - Get single gallery image
app.get('/admin/gallery/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      'SELECT * FROM gallery_images WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Gallery image not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching gallery image:', error);
    res.status(500).json({ error: 'Failed to fetch gallery image' });
  }
});

// POST /admin/gallery/upload - Upload new gallery images
app.post('/admin/gallery/upload', galleryUpload.array('images', 10), async (req, res) => {
  try {
    const uploadedImages = [];
    const { category = 'accommodation' } = req.body;
    
    // Handle file uploads
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const imageUrl = `/uploads/gallery/${category}/${file.filename}`;
        const title = req.body.title || `Gallery Image ${Date.now()}`;
        const altText = req.body.alt_text || title;
        const description = req.body.description || '';
        
        const [result] = await pool.execute(
          `INSERT INTO gallery_images 
           (title, category, image_url, alt_text, description) 
           VALUES (?, ?, ?, ?, ?)`,
          [title, category, imageUrl, altText, description]
        );
        
        uploadedImages.push({
          id: result.insertId,
          imageUrl,
          title,
          category,
          alt_text: altText,
          description
        });
      }
    }
    
    // Handle URL uploads
    if (req.body.imageUrls) {
      const urls = Array.isArray(req.body.imageUrls) ? req.body.imageUrls : [req.body.imageUrls];
      
      for (const url of urls) {
        if (url.trim()) {
          const title = req.body.title || `Gallery Image ${Date.now()}`;
          const altText = req.body.alt_text || title;
          const description = req.body.description || '';
          
          const [result] = await pool.execute(
            `INSERT INTO gallery_images 
             (title, category, image_url, alt_text, description) 
             VALUES (?, ?, ?, ?, ?)`,
            [title, category, url, altText, description]
          );
          
          uploadedImages.push({
            id: result.insertId,
            imageUrl: url,
            title,
            category,
            alt_text: altText,
            description
          });
        }
      }
    }
    
    if (uploadedImages.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }
    
    res.status(201).json({
      message: `${uploadedImages.length} image(s) uploaded successfully`,
      images: uploadedImages
    });
  } catch (error) {
    console.error('Error uploading gallery images:', error);
    res.status(500).json({ error: 'Failed to upload images' });
  }
});


// GET /admin/gallery/stats - Get gallery statistics
app.get('/admin/gallery/stats', async (req, res) => {
  try {
    // Total images
    const [totalResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM gallery_images WHERE active = 1'
    );
    
    // Images by category
    const [categoryResult] = await pool.execute(`
      SELECT 
        category,
        COUNT(*) as count
      FROM gallery_images 
      WHERE active = 1
      GROUP BY category
      ORDER BY count DESC
    `);
    
    res.json({
      total: totalResult[0].total,
      by_category: categoryResult
    });
  } catch (error) {
    console.error('Error fetching gallery stats:', error);
    res.status(500).json({ error: 'Failed to fetch gallery statistics' });
  }
});

// PUT /admin/gallery/:id - Update gallery image
app.put('/admin/gallery-2/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, alt_text, description, sort_order, active } = req.body;
    
    // Check if image exists
    const [existing] = await pool.execute(
      'SELECT * FROM gallery_images WHERE id = ?',
      [id]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Gallery image not found' });
    }
    
    // Prepare update query
    const updates = [];
    const params = [];
    
    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    
    if (category !== undefined) {
      updates.push('category = ?');
      params.push(category);
    }
    
    if (alt_text !== undefined) {
      updates.push('alt_text = ?');
      params.push(alt_text);
    }
    
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    
    if (sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(parseInt(sort_order));
    }
    
    if (active !== undefined) {
      updates.push('active = ?');
      params.push(active ? 1 : 0);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    
    await pool.execute(
      `UPDATE gallery_images SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    // Fetch updated image
    const [updated] = await pool.execute(
      'SELECT * FROM gallery_images WHERE id = ?',
      [id]
    );
    
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating gallery image:', error);
    res.status(500).json({ error: 'Failed to update gallery image' });
  }
});

// DELETE /admin/gallery/:id - Delete gallery image
app.delete('/admin/gallery-2/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get image details before deletion
    const [imageDetails] = await pool.execute(
      'SELECT image_url FROM gallery_images WHERE id = ?',
      [id]
    );
    
    if (imageDetails.length === 0) {
      return res.status(404).json({ error: 'Gallery image not found' });
    }
    
    // Delete from database
    const [result] = await pool.execute(
      'DELETE FROM gallery_images WHERE id = ?',
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Gallery image not found' });
    }
    
    // Try to delete physical file (optional - don't fail if file doesn't exist)
    try {
      const imagePath = imageDetails[0].image_url.replace('/uploads/', 'uploads/');
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    } catch (fileError) {
      console.warn('Could not delete physical file:', fileError.message);
    }
    
    res.json({ message: 'Gallery image deleted successfully' });
  } catch (error) {
    console.error('Error deleting gallery image:', error);
    res.status(500).json({ error: 'Failed to delete gallery image' });
  }
});


/* Removed duplicate upload declaration to avoid redeclaration error. */

// Routes

// GET /admin/services - Get all services with filtering and search
app.get('/admin/services', async (req, res) => {
  try {
    const { search, priceRange, availability, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;
    
    let query = 'SELECT * FROM services WHERE 1=1';
    const params = [];
    
    // Search functionality
    if (search) {
      query += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    // Price range filter
    if (priceRange) {
      switch (priceRange) {
        case 'budget':
          query += ' AND price < 1000';
          break;
        case 'mid':
          query += ' AND price >= 1000 AND price <= 2500';
          break;
        case 'premium':
          query += ' AND price > 2500';
          break;
      }
    }
    
    // Availability filter
    if (availability) {
      if (availability === 'available') {
        query += ' AND available = true';
      } else if (availability === 'unavailable') {
        query += ' AND available = false';
      }
    }
    
    // Sorting
    const validSortFields = ['name', 'price', 'duration', 'created_at'];
    const validSortOrders = ['ASC', 'DESC'];
    
    if (validSortFields.includes(sortBy) && validSortOrders.includes(sortOrder.toUpperCase())) {
      query += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
    }
    
    const [services] = await pool.execute(query, params);
    res.json(services);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// GET /admin/services/:id - Get single service
app.get('/admin/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [services] = await pool.execute('SELECT * FROM services WHERE id = ?', [id]);
    
    if (services.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    res.json(services[0]);
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({ error: 'Failed to fetch service' });
  }
});

// POST /admin/services - Create new service
app.post('/admin/services', async (req, res) => {
  try {
    const { name, description, image, price, duration, available = true } = req.body;
    
    // Validation
    if (!name || !description || !image || !price || !duration) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (price <= 0 || duration <= 0) {
      return res.status(400).json({ error: 'Price and duration must be greater than 0' });
    }
    
    const [result] = await pool.execute(
      'INSERT INTO services (name, description, image, price, duration, available) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description, image, price, duration, available]
    );
    
    // Fetch the created service
    const [newService] = await pool.execute('SELECT * FROM services WHERE id = ?', [result.insertId]);
    
    res.status(201).json(newService[0]);
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// PUT /admin/services/:id - Update service
app.put('/admin/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, image, price, duration, available } = req.body;
    
    // Validation
    if (!name || !description || !image || !price || !duration) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (price <= 0 || duration <= 0) {
      return res.status(400).json({ error: 'Price and duration must be greater than 0' });
    }
    
    const [result] = await pool.execute(
      'UPDATE services SET name = ?, description = ?, image = ?, price = ?, duration = ?, available = ? WHERE id = ?',
      [name, description, image, price, duration, available, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    // Fetch the updated service
    const [updatedService] = await pool.execute('SELECT * FROM services WHERE id = ?', [id]);
    
    res.json(updatedService[0]);
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// DELETE /admin/services/:id - Delete service
app.delete('/admin/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [result] = await pool.execute('DELETE FROM services WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// POST /admin/upload - Upload image
app.post('/admin/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ imageUrl });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});


// Helper function to format date for MySQL
const formatDateForMySQL = (date) => {
  return new Date(date).toISOString().split('T')[0];
};

// Routes

// GET /admin/blocked-dates - Fetch all blocked dates
app.get('/admin/blocked-dates', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, blocked_date, reason, created_at FROM blocked_dates ORDER BY blocked_date ASC'
    );

    // Format dates for frontend
    const formattedRows = rows.map(row => ({
      ...row,
      blocked_date: row.blocked_date.toISOString().split('T')[0]
    }));

    res.json({
      success: true,
      data: formattedRows
    });
  } catch (error) {
    console.error('Error fetching blocked dates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch blocked dates',
      error: error.message
    });
  }
});

// POST /admin/blocked-dates - Add new blocked dates
app.post('/admin/blocked-dates', [
  body('dates').isArray().withMessage('Dates must be an array'),
  body('dates.*').isISO8601().withMessage('Each date must be in valid ISO format'),
  body('reason').optional().isString().withMessage('Reason must be a string')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { dates, reason } = req.body;

    if (!dates || dates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one date is required'
      });
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const insertedDates = [];
      const duplicateDates = [];

      for (const date of dates) {
        const formattedDate = formatDateForMySQL(date);
        
        try {
          await connection.execute(
            'INSERT INTO blocked_dates (blocked_date, reason) VALUES (?, ?)',
            [formattedDate, reason || null]
          );
          insertedDates.push(formattedDate);
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') {
            duplicateDates.push(formattedDate);
          } else {
            throw error;
          }
        }
      }

      await connection.commit();
      connection.release();

      res.json({
        success: true,
        message: `Successfully blocked ${insertedDates.length} date(s)`,
        data: {
          inserted: insertedDates,
          duplicates: duplicateDates
        }
      });

    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }

  } catch (error) {
    console.error('Error adding blocked dates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add blocked dates',
      error: error.message
    });
  }
});

// DELETE /admin/blocked-dates/:id - Remove a blocked date
app.delete('/admin/blocked-dates/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Valid ID is required'
      });
    }

    const [result] = await pool.execute(
      'DELETE FROM blocked_dates WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blocked date not found'
      });
    }

    res.json({
      success: true,
      message: 'Blocked date removed successfully'
    });

  } catch (error) {
    console.error('Error removing blocked date:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove blocked date',
      error: error.message
    });
  }
});

// DELETE /admin/blocked-dates/by-date/:date - Remove blocked date by date
app.delete('/admin/blocked-dates/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const formattedDate = formatDateForMySQL(date);

    const [result] = await pool.execute(
      'DELETE FROM blocked_dates WHERE blocked_date = ?',
      [formattedDate]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blocked date not found'
      });
    }

    res.json({
      success: true,
      message: 'Blocked date removed successfully'
    });

  } catch (error) {
    console.error('Error removing blocked date:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove blocked date',
      error: error.message
    });
  }
});

// PUT /admin/blocked-dates/:id - Update a blocked date
app.put('/admin/blocked-dates/:id', [
  body('reason').optional().isString().withMessage('Reason must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { reason } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Valid ID is required'
      });
    }

    const [result] = await pool.execute(
      'UPDATE blocked_dates SET reason = ? WHERE id = ?',
      [reason || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blocked date not found'
      });
    }

    res.json({
      success: true,
      message: 'Blocked date updated successfully'
    });

  } catch (error) {
    console.error('Error updating blocked date:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update blocked date',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/admin/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Resort Calendar admin'
  });
});


// Dashboard stats endpoint
app.get('/admin/dashboard/stats', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // Get total bookings
    const [totalBookings] = await connection.execute(
      'SELECT COUNT(*) as count FROM bookings'
    );
    
    // Get total bookings for last month to calculate change
    const [lastMonthBookings] = await connection.execute(
      'SELECT COUNT(*) as count FROM bookings WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH) AND created_at < DATE_SUB(CURDATE(), INTERVAL 1 MONTH)'
    );
    
    // Calculate occupancy rate (confirmed bookings vs available rooms)
    const [totalRooms] = await connection.execute(
      'SELECT SUM(available_rooms) as total FROM accommodations WHERE available = 1'
    );
    
    const [occupiedRooms] = await connection.execute(
      'SELECT SUM(b.rooms) as occupied FROM bookings b WHERE b.status = "confirmed" AND b.check_in_date <= CURDATE() AND b.check_out_date > CURDATE()'
    );
    
    const occupancyRate = totalRooms[0].total > 0 
      ? Math.round((occupiedRooms[0].occupied || 0) / totalRooms[0].total * 100) 
      : 0;
    
    // Get total revenue
    const [totalRevenue] = await connection.execute(
      'SELECT SUM(total_amount) as revenue FROM bookings WHERE status IN ("confirmed", "completed")'
    );
    
    // Get last month revenue for comparison
    const [lastMonthRevenue] = await connection.execute(
      'SELECT SUM(total_amount) as revenue FROM bookings WHERE status IN ("confirmed", "completed") AND created_at >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH) AND created_at < DATE_SUB(CURDATE(), INTERVAL 1 MONTH)'
    );
    
    // Calculate booking change percentage
    const currentBookings = totalBookings[0].count;
    const previousBookings = lastMonthBookings[0].count || 1;
    const bookingChange = Math.round(((currentBookings - previousBookings) / previousBookings) * 100);
    
    // Calculate revenue change percentage
    const currentRevenue = totalRevenue[0].revenue || 0;
    const previousRevenue = lastMonthRevenue[0].revenue || 1;
    const revenueChange = Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100);
    
    connection.release();
    
    res.json({
      totalBookings: currentBookings,
      bookingChange: `${bookingChange > 0 ? '+' : ''}${bookingChange}%`,
      occupancyRate: `${occupancyRate}%`,
      occupancyChange: '+8%', // Static for demo
      revenue: `₹${Math.round(currentRevenue).toLocaleString()}`,
      revenueChange: `${revenueChange > 0 ? '+' : ''}${revenueChange}%`,
      websiteVisitors: '2,450', // Static for demo
      visitorsChange: '+22%' // Static for demo
    });
    
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Quick access counts endpoint
app.get('/admin/dashboard/quick-stats', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // Get accommodations count
    const [accommodations] = await connection.execute(
      'SELECT COUNT(*) as count FROM accommodations WHERE available = 1'
    );
    
    // Get gallery images count
    const [gallery] = await connection.execute(
      'SELECT COUNT(*) as count FROM gallery_images WHERE active = 1'
    );
    
    // Get services count
    const [services] = await connection.execute(
      'SELECT COUNT(*) as count FROM services WHERE available = 1'
    );
    
    // Get today's bookings count
    const [todayBookings] = await connection.execute(
      'SELECT COUNT(*) as count FROM bookings WHERE DATE(created_at) = CURDATE()'
    );
    
    connection.release();
    
    res.json({
      accommodations: accommodations[0].count,
      gallery: gallery[0].count,
      services: services[0].count,
      todayBookings: todayBookings[0].count
    });
    
  } catch (error) {
    console.error('Error fetching quick stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Recent bookings endpoint
app.get('/admin/dashboard/recent-bookings', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [bookings] = await connection.execute(`
      SELECT 
        b.id,
        b.guest_name,
        b.guest_email,
        b.check_in_date,
        b.check_out_date,
        b.total_amount,
        b.status,
        b.created_at,
        a.title as accommodation_title
      FROM bookings b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      ORDER BY b.created_at DESC
      LIMIT 5
    `);
    
    connection.release();
    
    const formattedBookings = bookings.map(booking => ({
      id: booking.id,
      guestName: booking.guest_name,
      email: booking.guest_email,
      checkIn: booking.check_in_date,
      checkOut: booking.check_out_date,
      amount: booking.total_amount,
      status: booking.status,
      accommodation: booking.accommodation_title || 'N/A',
      createdAt: booking.created_at
    }));
    
    res.json(formattedBookings);
    
  } catch (error) {
    console.error('Error fetching recent bookings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Revenue trend endpoint (last 7 days)
app.get('/admin/dashboard/revenue-trend', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [revenueData] = await connection.execute(`
      SELECT 
        DATE(created_at) as date,
        SUM(total_amount) as revenue
      FROM bookings 
      WHERE status IN ('confirmed', 'completed')
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);
    
    connection.release();
    
    // Fill in missing dates with 0 revenue
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const existingData = revenueData.find(item => 
        item.date.toISOString().split('T')[0] === dateStr
      );
      
      last7Days.push({
        date: dateStr,
        revenue: existingData ? parseFloat(existingData.revenue) : 0
      });
    }
    
    res.json(last7Days);
    
  } catch (error) {
    console.error('Error fetching revenue trend:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all accommodations
app.get('/admin/accommodations', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [accommodations] = await connection.execute(
      'SELECT * FROM accommodations WHERE available = 1 ORDER BY created_at DESC'
    );
    
    connection.release();
    res.json(accommodations);
    
  } catch (error) {
    console.error('Error fetching accommodations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all services
app.get('/admin/services', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [services] = await connection.execute(
      'SELECT * FROM services WHERE available = 1 ORDER BY created_at DESC'
    );
    
    connection.release();
    res.json(services);
    
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get gallery images
app.get('/admin/gallery', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [images] = await connection.execute(
      'SELECT * FROM gallery_images WHERE active = 1 ORDER BY sort_order ASC'
    );
    
    connection.release();
    res.json(images);
    
  } catch (error) {
    console.error('Error fetching gallery images:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Routes

// Get all bookings
app.get('/admin/bookings', async (req, res) => {
  try {
    const { search, status, payment_status, start_date, end_date } = req.query;
    
    let query = `
      SELECT 
        b.*,
        a.title as accommodation_title,
        mp.title as meal_plan_title,
        COALESCE(SUM(p.amount), 0) as paid_amount
      FROM bookings b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      LEFT JOIN meal_plans mp ON b.meal_plan_id = mp.id
      LEFT JOIN payments p ON b.id = p.booking_id AND p.status = 'success'
      WHERE 1=1
    `;
    
    const params = [];
    
    if (search) {
      query += ` AND (b.guest_name LIKE ? OR b.guest_email LIKE ? OR a.title LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    if (status) {
      query += ` AND b.status = ?`;
      params.push(status);
    }
    
    if (payment_status) {
      query += ` AND b.payment_status = ?`;
      params.push(payment_status);
    }
    
    if (start_date) {
      query += ` AND b.check_in_date >= ?`;
      params.push(start_date);
    }
    
    if (end_date) {
      query += ` AND b.check_out_date <= ?`;
      params.push(end_date);
    }
    
    query += ` GROUP BY b.id ORDER BY b.created_at DESC`;
    
    const [rows] = await pool.execute(query, params);
    
    // Format the response to match frontend expectations
    const formattedBookings = rows.map(booking => ({
      id: booking.id,
      bookingId: `B${booking.id.toString().padStart(5, '0')}`,
      guest: booking.guest_name,
      email: booking.guest_email,
      phone: booking.guest_phone,
      accommodation: booking.accommodation_title || 'N/A',
      checkIn: formatDate(booking.check_in_date),
      checkOut: formatDate(booking.check_out_date),
      guests: booking.adults + (booking.children || 0),
      amount: `₹${parseFloat(booking.total_amount).toLocaleString('en-IN')}`,
      paidAmount: `₹${parseFloat(booking.paid_amount).toLocaleString('en-IN')}`,
      paymentStatus: calculatePaymentStatus(booking.total_amount, booking.paid_amount),
      bookingStatus: booking.status.charAt(0).toUpperCase() + booking.status.slice(1),
      rawData: booking
    }));
    
    res.json(formattedBookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Get single booking
app.get('/admin/bookings/:id', async (req, res) => {
  try {
    const bookingId = req.params.id;
    
    const query = `
      SELECT 
        b.*,
        a.title as accommodation_title,
        a.description as accommodation_description,
        mp.title as meal_plan_title,
        mp.price as meal_plan_price,
        COALESCE(SUM(p.amount), 0) as paid_amount
      FROM bookings b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      LEFT JOIN meal_plans mp ON b.meal_plan_id = mp.id
      LEFT JOIN payments p ON b.id = p.booking_id AND p.status = 'success'
      WHERE b.id = ?
      GROUP BY b.id
    `;
    
    const [rows] = await pool.execute(query, [bookingId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const booking = rows[0];
    
    // Get booking activities
    const activitiesQuery = `
      SELECT a.* FROM activities a
      JOIN booking_activities ba ON a.id = ba.activity_id
      WHERE ba.booking_id = ?
    `;
    const [activities] = await pool.execute(activitiesQuery, [bookingId]);
    
    // Get payment history
    const paymentsQuery = `
      SELECT * FROM payments 
      WHERE booking_id = ? 
      ORDER BY created_at DESC
    `;
    const [payments] = await pool.execute(paymentsQuery, [bookingId]);
    
    const formattedBooking = {
      id: booking.id,
      bookingId: `B${booking.id.toString().padStart(5, '0')}`,
      guest: booking.guest_name,
      email: booking.guest_email,
      phone: booking.guest_phone,
      accommodation: booking.accommodation_title || 'N/A',
      accommodationDescription: booking.accommodation_description,
      checkIn: formatDate(booking.check_in_date),
      checkOut: formatDate(booking.check_out_date),
      adults: booking.adults,
      children: booking.children || 0,
      rooms: booking.rooms || 1,
      guests: booking.adults + (booking.children || 0),
      amount: `₹${parseFloat(booking.total_amount).toLocaleString('en-IN')}`,
      paidAmount: `₹${parseFloat(booking.paid_amount).toLocaleString('en-IN')}`,
      paymentStatus: calculatePaymentStatus(booking.total_amount, booking.paid_amount),
      bookingStatus: booking.status.charAt(0).toUpperCase() + booking.status.slice(1),
      specialRequests: booking.special_requests,
      mealPlan: booking.meal_plan_title,
      activities: activities,
      payments: payments,
      rawData: booking
    };
    
    res.json(formattedBooking);
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Failed to fetch booking details' });
  }
});

// Create new booking
app.post('/admin/bookings', async (req, res) => {
  try {
    const {
      guest_name,
      guest_email,
      guest_phone,
      check_in_date,
      check_out_date,
      adults,
      children,
      accommodation_id,
      rooms,
      meal_plan_id,
      coupon_code,
      total_amount,
      special_requests,
      activities = []
    } = req.body;
    
    // Start transaction
    await db.beginTransaction();
    
    // Insert booking
    const bookingQuery = `
      INSERT INTO bookings (
        guest_name, guest_email, guest_phone, check_in_date, check_out_date,
        adults, children, accommodation_id, rooms, meal_plan_id, coupon_code,
        total_amount, special_requests
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const [bookingResult] = await pool.execute(bookingQuery, [
      guest_name, guest_email, guest_phone, check_in_date, check_out_date,
      adults, children || 0, accommodation_id, rooms || 1, meal_plan_id,
      coupon_code, total_amount, special_requests
    ]);
    
    const bookingId = bookingResult.insertId;
    
    // Insert booking activities
    if (activities.length > 0) {
      const activityQuery = `INSERT INTO booking_activities (booking_id, activity_id) VALUES (?, ?)`;
      for (const activityId of activities) {
        await pool.execute(activityQuery, [bookingId, activityId]);
      }
    }
    
    // Insert room bookings
    if (accommodation_id) {
      const roomQuery = `
        INSERT INTO booking_rooms (booking_id, accommodation_id, check_in_date, check_out_date)
        VALUES (?, ?, ?, ?)
      `;
      await pool.execute(roomQuery, [bookingId, accommodation_id, check_in_date, check_out_date]);
    }
    
    await db.commit();
    
    res.status(201).json({
      success: true,
      bookingId: bookingId,
      message: 'Booking created successfully'
    });
  } catch (error) {
    await db.rollback();
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Add payment to booking
app.post('/admin/bookings/:id/payments', async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { amount, payment_method, transaction_id, notes } = req.body;
    
    // Insert payment record
    const paymentQuery = `
      INSERT INTO payments (booking_id, amount, status, payment_method, transaction_id)
      VALUES (?, ?, 'success', ?, ?)
    `;
    
    await pool.execute(paymentQuery, [bookingId, amount, payment_method, transaction_id]);
    
    // Update booking payment status
    const totalPaidQuery = `
      SELECT COALESCE(SUM(amount), 0) as total_paid, b.total_amount
      FROM payments p
      RIGHT JOIN bookings b ON p.booking_id = b.id
      WHERE b.id = ? AND (p.status = 'success' OR p.status IS NULL)
      GROUP BY b.id
    `;
    
    const [paymentInfo] = await pool.execute(totalPaidQuery, [bookingId]);
    
    if (paymentInfo.length > 0) {
      const totalPaid = parseFloat(paymentInfo[0].total_paid);
      const totalAmount = parseFloat(paymentInfo[0].total_amount);
      
      let paymentStatus = 'pending';
      if (totalPaid >= totalAmount) {
        paymentStatus = 'paid';
      } else if (totalPaid > 0) {
        paymentStatus = 'pending'; // Partial payments still show as pending in this schema
      }
      
      await pool.execute(
        'UPDATE bookings SET payment_status = ? WHERE id = ?',
        [paymentStatus, bookingId]
      );
    }
    
    res.json({
      success: true,
      message: 'Payment added successfully'
    });
  } catch (error) {
    console.error('Error adding payment:', error);
    res.status(500).json({ error: 'Failed to add payment' });
  }
});

// Get accommodations
app.get('/admin/accommodations', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM accommodations WHERE available = 1');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching accommodations:', error);
    res.status(500).json({ error: 'Failed to fetch accommodations' });
  }
});

// Get meal plans
app.get('/admin/meal-plans', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM meal_plans WHERE available = 1');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching meal plans:', error);
    res.status(500).json({ error: 'Failed to fetch meal plans' });
  }
});

// Get activities
app.get('/admin/activities', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM activities WHERE available = 1');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// Get coupons
app.get('/admin/coupons', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM coupons 
      WHERE active = 1 AND (expiry_date IS NULL OR expiry_date >= CURDATE())
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

// Validate coupon
app.post('/admin/coupons/validate', async (req, res) => {
  try {
    const { code, amount } = req.body;
    
    const [rows] = await pool.execute(`
      SELECT * FROM coupons 
      WHERE code = ? AND active = 1 
      AND (expiry_date IS NULL OR expiry_date >= CURDATE())
      AND (usage_limit IS NULL OR used_count < usage_limit)
      AND min_amount <= ?
    `, [code, amount]);
    
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired coupon' });
    }
    
    const coupon = rows[0];
    let discount = 0;
    
    if (coupon.discount_type === 'percentage') {
      discount = (amount * coupon.discount_percentage) / 100;
      if (coupon.max_discount && discount > coupon.max_discount) {
        discount = coupon.max_discount;
      }
    } else {
      discount = coupon.discount_percentage; // Fixed amount
    }
    
    res.json({
      valid: true,
      discount: discount,
      coupon: coupon
    });
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({ error: 'Failed to validate coupon' });
  }
});

// Get blocked dates
app.get('/admin/blocked-dates', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT blocked_date FROM blocked_dates');
    const dates = rows.map(row => row.blocked_date);
    res.json(dates);
  } catch (error) {
    console.error('Error fetching blocked dates:', error);
    res.status(500).json({ error: 'Failed to fetch blocked dates' });
  }
});

// Export bookings to CSV
app.get('/admin/bookings/export/csv', async (req, res) => {
  try {
    const query = `
      SELECT 
        CONCAT('B', LPAD(b.id, 5, '0')) as booking_id,
        b.guest_name,
        b.guest_email,
        b.guest_phone,
        a.title as accommodation,
        b.check_in_date,
        b.check_out_date,
        b.adults,
        b.children,
        b.total_amount,
        COALESCE(SUM(p.amount), 0) as paid_amount,
        b.status,
        b.payment_status,
        b.created_at
      FROM bookings b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      LEFT JOIN payments p ON b.id = p.booking_id AND p.status = 'success'
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `;
    
    const [rows] = await pool.execute(query);
    
    // Convert to CSV
    const headers = [
      'Booking ID', 'Guest Name', 'Email', 'Phone', 'Accommodation',
      'Check In', 'Check Out', 'Adults', 'Children', 'Total Amount',
      'Paid Amount', 'Status', 'Payment Status', 'Created At'
    ];
    
    let csv = headers.join(',') + '\n';
    
    rows.forEach(row => {
      const values = [
        row.booking_id,
        `"${row.guest_name}"`,
        row.guest_email,
        row.guest_phone || '',
        `"${row.accommodation || ''}"`,
        row.check_in_date,
        row.check_out_date,
        row.adults,
        row.children || 0,
        row.total_amount,
        row.paid_amount,
        row.status,
        row.payment_status,
        row.created_at
      ];
      csv += values.join(',') + '\n';
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=bookings.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting bookings:', error);
    res.status(500).json({ error: 'Failed to export bookings' });
  }
});


// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
  }
  
  if (error.message === 'Only image files are allowed!') {
    return res.status(400).json({ error: 'Only image files are allowed!' });
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });

});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await testConnection();
});

module.exports = app;