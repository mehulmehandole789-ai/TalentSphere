// AUTOMATED TEST TRANSPORT ONLY. Captures messages in memory and sends no real email.
function installMockMail(app){
 const messages=[];
 app.locals.mailTransport={sendMail:async message=>{messages.push(structuredClone(message));return {accepted:[message.to]};}};
 return {messages,latestCode(email){const message=[...messages].reverse().find(m=>m.to.toLowerCase()===email.toLowerCase()&&m.subject==='Verify your TalentSphere email');if(!message)throw new Error('No mock verification message.');return message.text.match(/code is: (\d{6})/)[1];}};
}
module.exports={installMockMail};
