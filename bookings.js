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

// Get all accommodations
router.get('/accommodations', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, description, price, available_rooms, amenities, image_url FROM accommodations WHERE available = 1'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching accommodations:', error);
    res.status(500).json({ error: 'Failed to fetch accommodations' });
  }
});

// Get all meal plans
router.get('/meal-plans', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, description, price FROM meal_plans WHERE available = 1'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching meal plans:', error);
    res.status(500).json({ error: 'Failed to fetch meal plans' });
  }
});

// Create new booking
router.post('/bookings', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const {
      guestName,
      email,
      phone,
      accommodationId,
      checkIn,
      checkOut,
      adults,
      children = 0,
      rooms = 1,
      mealPlanId,
      totalAmount,
      paymentAmount,
      paymentMethod,
      transactionId,
      notes
    } = req.body;

    // Insert booking
    const [bookingResult] = await connection.execute(
      `INSERT INTO bookings (
        guest_name, guest_email, guest_phone, check_in_date, check_out_date,
        adults, children, accommodation_id, rooms, meal_plan_id, total_amount,
        special_requests, status, payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'pending')`,
      [
        guestName, email, phone, checkIn, checkOut,
        adults, children, accommodationId, rooms, mealPlanId,
        totalAmount, notes
      ]
    );

    const bookingId = bookingResult.insertId;

    // Insert room booking
    await connection.execute(
      `INSERT INTO booking_rooms (
        booking_id, accommodation_id, check_in_date, check_out_date
      ) VALUES (?, ?, ?, ?)`,
      [bookingId, accommodationId, checkIn, checkOut]
    );

    // Insert payment record if payment details provided
    if (paymentAmount && paymentMethod) {
      const paymentStatus = paymentAmount >= totalAmount ? 'success' : 'pending';
      
      await connection.execute(
        `INSERT INTO payments (
          booking_id, amount, status, payment_method, transaction_id
        ) VALUES (?, ?, ?, ?, ?)`,
        [bookingId, paymentAmount, paymentStatus, paymentMethod, transactionId]
      );

      // Update booking payment status
      await connection.execute(
        'UPDATE bookings SET payment_status = ? WHERE id = ?',
        [paymentStatus, bookingId]
      );
    }

    await connection.commit();
    
    res.status(201).json({
      success: true,
      bookingId,
      message: 'Booking created successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  } finally {
    connection.release();
  }
});

// Get all bookings
router.get('/bookings', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        b.id,
        b.guest_name,
        b.guest_email,
        b.guest_phone,
        b.check_in_date,
        b.check_out_date,
        b.adults,
        b.children,
        b.available_rooms,
        b.total_amount,
        b.status,
        b.payment_status,
        b.special_requests,
        b.created_at,
        a.title as accommodation_name,
        a.price as accommodation_price,
        mp.title as meal_plan_name,
        p.amount as payment_amount,
        p.payment_method,
        p.transaction_id
      FROM bookings b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      LEFT JOIN meal_plans mp ON b.meal_plan_id = mp.id
      LEFT JOIN payments p ON b.id = p.booking_id
      ORDER BY b.created_at DESC
    `);
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Get booking by ID
router.get('/bookings/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        b.*,
        a.title as accommodation_name,
        a.price as accommodation_price,
        mp.title as meal_plan_name,
        p.amount as payment_amount,
        p.payment_method,
        p.transaction_id
      FROM bookings b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      LEFT JOIN meal_plans mp ON b.meal_plan_id = mp.id
      LEFT JOIN payments p ON b.id = p.booking_id
      WHERE b.id = ?
    `, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

// Update booking
router.put('/bookings/:id', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const bookingId = req.params.id;
    const {
      guestName,
      email,
      phone,
      accommodationId,
      checkIn,
      checkOut,
      adults,
      children,
      rooms,
      mealPlanId,
      totalAmount,
      status,
      notes
    } = req.body;

    // Update booking
    await connection.execute(
      `UPDATE bookings SET 
        guest_name = ?, guest_email = ?, guest_phone = ?, 
        check_in_date = ?, check_out_date = ?, adults = ?, children = ?,
        accommodation_id = ?, rooms = ?, meal_plan_id = ?, total_amount = ?,
        status = ?, special_requests = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        guestName, email, phone, checkIn, checkOut, adults, children,
        accommodationId, rooms, mealPlanId, totalAmount, status, notes, bookingId
      ]
    );

    // Update booking_rooms
    await connection.execute(
      `UPDATE booking_rooms SET 
        accommodation_id = ?, check_in_date = ?, check_out_date = ?
      WHERE booking_id = ?`,
      [accommodationId, checkIn, checkOut, bookingId]
    );

    await connection.commit();
    
    res.json({
      success: true,
      message: 'Booking updated successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  } finally {
    connection.release();
  }
});

// Delete booking
router.delete('/bookings/:id', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const bookingId = req.params.id;

    // Delete related records first
    await connection.execute('DELETE FROM payments WHERE booking_id = ?', [bookingId]);
    await connection.execute('DELETE FROM booking_rooms WHERE booking_id = ?', [bookingId]);
    await connection.execute('DELETE FROM booking_activities WHERE booking_id = ?', [bookingId]);
    
    // Delete booking
    await connection.execute('DELETE FROM bookings WHERE id = ?', [bookingId]);

    await connection.commit();
    
    res.json({
      success: true,
      message: 'Booking deleted successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'Failed to delete booking' });
  } finally {
    connection.release();
  }
});

// Check room availability
router.post('/check-availability', async (req, res) => {
  try {
    const { accommodationId, checkIn, checkOut, rooms = 1 } = req.body;

    const [rows] = await pool.execute(`
      SELECT 
  a.available_rooms,
  COALESCE(SUM(br_count.booked_rooms), 0) AS booked_rooms
FROM accommodations a
LEFT JOIN (
  SELECT 
    br.accommodation_id,
    COUNT(*) AS booked_rooms
  FROM booking_rooms br
  JOIN bookings b ON br.booking_id = b.id
  WHERE 
    b.status NOT IN ('cancelled', 'completed')
    AND br.check_in_date < ?  -- Replace with check_out_date of the query range
    AND br.check_out_date > ? -- Replace with check_in_date of the query range
  GROUP BY br.accommodation_id
) br_count ON a.id = br_count.accommodation_id
WHERE a.id = ?
GROUP BY a.id, a.available_rooms;

    `, [checkOut, checkIn, accommodationId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Accommodation not found' });
    }
    

    const { available_rooms, booked_rooms } = rows[0];
    const availableRooms = available_rooms - booked_rooms;

    res.json({
      available: availableRooms >= rooms,
      availableRooms,
      requestedRooms: rooms
    });

  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

module.exports = router;