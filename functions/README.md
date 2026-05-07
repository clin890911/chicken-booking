# LINE Messaging API / LIFF setup

This folder contains Firebase Cloud Functions for the LINE integration.

## Functions

- `lineBind`: called by the LIFF binding page. It stores the booking + LINE user binding in Firestore and pushes a booking Flex Message plus a location message.
- `lineWebhook`: LINE Messaging API webhook with signature verification.
- `linePushBooking`: reusable endpoint for pushing the latest booking notification after edits/cancellations.

## Required Firebase secrets

```bash
firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
firebase functions:secrets:set LINE_CHANNEL_SECRET
```

## Required app settings

In the admin settings page:

- LINE Official Account URL
- LIFF URL
- LIFF ID
- LINE bind endpoint URL, for example `https://<region>-<project>.cloudfunctions.net/lineBind`
- Store name
- Store address
- Store phone
- Google Maps URL
- Store latitude and longitude

## LINE Developers console

- Enable Messaging API.
- Enable webhook.
- Set webhook URL to the deployed `lineWebhook` endpoint.
- Create a LIFF app with `profile` scope.
- Set the LIFF endpoint URL to the deployed frontend route or LIFF URL used by the app.
- Enable the add-friend option for the LIFF app if available.

## Notes

The frontend still supports LocalStorage mode. For full production reliability, bookings should eventually move to Firestore so the backend can validate booking tokens without relying on client-supplied booking snapshots.
