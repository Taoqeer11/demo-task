import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  source: { type: String, required: true },
  destination: { type: String, required: true },
  amount: { type: Number, required: true },
  buyerFloatPercent: { type: Number, default: 0 }, // buyer-added float %
  sojorPercent: { type: Number, default: 0 }, // percent fetched from AS (optional)
  floatCharge: Number,
  sojorCharge: Number,
  grandTotal: Number,
  imageUrl: String,
  status: { type: String, enum: ["PENDING","WAITING","READY_FOR_AUTH","AUTHORIZED","SETTLED","CANCELLED"], default: "PENDING" },
  createdAt: { type: Date, default: Date.now },
  ttlExpiresAt: Date,
  userId: String
});

// TTL index to auto-remove expired transactions
transactionSchema.index({ ttlExpiresAt: 1 }, { expireAfterSeconds: 0 });
// Helpful indexes for common queries
transactionSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("Transaction", transactionSchema);
