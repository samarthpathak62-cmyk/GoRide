const test=require('node:test');
const assert=require('node:assert/strict');
const {requirements,validateApplication,ownedPath,canOperate,categoryVehicle}=require('../src/services/onboardingValidation');
const now=new Date('2026-10-31T12:00:00Z'), uid='test-user';
function application(vehicleType='Bike') {
 const spec=requirements.vehicles.find(v=>v.id===vehicleType);
 return {fullName:'Test Captain',dateOfBirth:'1990-01-01',vehicleType,vehicleModel:'Model 2024',city:'Delhi',postalCode:'110001',registrationNumber:'DL01AB1234',consent:true,
 documents:Object.fromEntries(spec.documents.map(k=>[k,{path:`${uid}/${k}/file.jpg`,...(requirements.documents[k].expires?{expiresOn:'2028-01-01'}:{})}]))};
}
test('Bike, Auto and Car require distinct appropriate operational checklists',()=>{
 for(const type of ['Bike','Auto','Car']) assert.ok(validateApplication(uid,application(type),now));
 assert.equal(requirements.vehicles.find(v=>v.id==='Bike').documents.includes('permit'),false);
 assert.equal(requirements.vehicles.find(v=>v.id==='Auto').documents.includes('fitness'),true);
});
test('missing, foreign, external and traversing document paths are rejected',()=>{
 for(const path of [undefined,'other/identity/file.jpg','https://example.com/file.jpg',`${uid}/identity/../../file.jpg`]){
  const a=application();a.documents.identity={path};assert.throws(()=>validateApplication(uid,a,now));
 }
 assert.equal(ownedPath(`${uid}/identity/file.jpg`,uid,'identity'),true);
});
test('underage, invalid dates, expired evidence, missing consent and unsupported cities fail closed',()=>{
 for(const patch of [{dateOfBirth:'2015-01-01'},{dateOfBirth:'1990-02-30'},{consent:false},{city:'Mumbai'},{vehicleType:'Truck'},{postalCode:'1'}]) assert.throws(()=>validateApplication(uid,{...application(),...patch},now));
 const a=application();a.documents.insurance.expiresOn='2026-10-30';assert.throws(()=>validateApplication(uid,a,now),/expiry/);
});
test('only reviewed, operationally enabled captains with valid documents can operate',()=>{
 const a=application();const driver={user_id:uid,full_name:a.fullName,date_of_birth:a.dateOfBirth,vehicle_model:a.vehicleModel,vehicle_type:a.vehicleType,city:a.city,postal_code:a.postalCode,registration_number:a.registrationNumber,documents:a.documents,status:'approved',operationally_enabled:true};
 assert.equal(canOperate(driver,now),true);
 assert.equal(canOperate({...driver,status:'pending'},now),false);
 assert.equal(canOperate({...driver,operationally_enabled:false},now),false);
 assert.equal(canOperate(driver,new Date('2030-01-01')),false);
 assert.equal(categoryVehicle('Ride'),'Car');assert.equal(categoryVehicle('Auto'),'Auto');
});
