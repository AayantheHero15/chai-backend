import mongoose, {Schema} from "mongoose";

const subscriptionSchema = new Schema({
    subscriber: {
        type: Schema.Types.ObjectId, // one who is subscribing
        ref: "User",
        required: true
    },

    channel: {
        type: Schema.Types.ObjectId, // one to whom 'subscriber' is subscribing
        ref: "User",
        required: true
    },
}, { timestamps: true })

// to get the number of subscribers of the channel from the schema:
// Count the numbers of occurence of that channel in the documents

// to get the number of channel subscribed by a subscriber from the schema:
// Count the numbers of occurence of that subscriber in the documents 

export const Subscription = mongoose.model("Subscription", subscriptionSchema)
