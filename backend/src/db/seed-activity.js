require('dotenv').config({path:require('node:path').join(__dirname,'../../.env')});
const db=require('./index');
if(process.env.NODE_ENV==='production')throw new Error('Sample activity is for local development only.');
const day=offset=>{const date=new Date();date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
const artists=db.prepare("SELECT a.*,u.email FROM artist_profiles a JOIN users u ON u.id=a.userId WHERE u.name LIKE '[Demo]%' ORDER BY u.email").all();
const organizer=db.prepare("SELECT * FROM users WHERE email='alex@talentsphere.io' AND name LIKE '[Demo]%'").get();
if(!organizer||artists.length<4)throw new Error('Existing local sample accounts are required.');
const events=db.prepare('SELECT * FROM events WHERE organizerId=? ORDER BY date').all(organizer.id);
if(!events.length)throw new Error('Sample organizer needs published events.');
const insertBooking=db.prepare(`INSERT OR IGNORE INTO bookings
 (id,artistId,organizerId,eventName,date,duration,location,fee,platformFee,status,artistFeePaise,platformFeePaise,finalAmountPaise,paymentRequired)
 VALUES(?,?,?,?,?,'3 hours',?,?,0,?,?,0,?,?)`);
const insertApplication=db.prepare('INSERT OR IGNORE INTO applications(id,eventId,artistId,message,fee,status) VALUES(?,?,?,?,?,?)');
const insertCollab=db.prepare('INSERT OR IGNORE INTO collaborations(id,fromId,toId,message,status) VALUES(?,?,?,?,?)');
const insertNotice=db.prepare('INSERT OR IGNORE INTO notifications(id,userId,text,kind,read) VALUES(?,?,?,?,0)');
const history=[['Autumn Arts Evening',-65,'Completed'],['City Sessions',-42,'Completed'],['Brand Launch',-24,'Completed'],['Community Arts Weekend',-10,'Completed'],['Annual Celebration',8,'Confirmed'],['Winter Showcase',18,'Confirmed'],['Studio Sessions',25,'Accepted'],['Private Celebration',12,'Pending'],['Creative Industry Meetup',31,'Pending']];
db.transaction(()=>{
 for(const [index,artist] of artists.entries()){
  for(const [slot,[title,offset,status]] of history.entries()){
   const key=`sample-activity-booking-${artist.id}-${slot}`,fee=artist.price;
   insertBooking.run(key,artist.id,organizer.id,title,day(offset+index),'Mumbai, IN',fee,status,fee*100,fee*100,['Pending','Accepted'].includes(status)?1:0);
  }
  for(let slot=0;slot<3;slot++){
   const event=events[slot%events.length];
   if(!db.prepare('SELECT id FROM applications WHERE eventId=? AND artistId=?').get(event.id,artist.id)){
    insertApplication.run(`sample-activity-app-${artist.id}-${slot}`,event.id,artist.id,'I am available for this event and would be happy to discuss the brief.',artist.price,'Pending');
   }
   const from=artists[(index+slot+1)%artists.length];
   if(!db.prepare("SELECT id FROM collaborations WHERE fromId=? AND toId=? AND status='Pending'").get(from.id,artist.id)){
    insertCollab.run(`sample-activity-collab-${artist.id}-${slot}`,from.id,artist.id,['Would you be interested in creating a live session together?','I am planning a collaborative showcase next month. Would you like to join?','Your work would be a great fit for an upcoming creative project. Let us discuss the brief.'][slot],'Pending');
   }
  }
  insertNotice.run(`sample-activity-notice-${artist.id}`,artist.userId,'You have booking and collaboration requests to review.','booking');
 }
 insertNotice.run('sample-activity-notice-organizer',organizer.id,'New artist applications are ready to review.','application');
})();
console.log('Local sample activity added. Existing records and real accounts were preserved; no payment transactions were created.');
db.close();
