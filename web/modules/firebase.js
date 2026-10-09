const juviaFirebaseConfig = {
  apiKey: 'AIzaSyCveYoyFHyijK9ZCbjFTTO1QhjqB-9DN5A',
  authDomain: 'juvia-b0ed2.firebaseapp.com',
  projectId: 'juvia-b0ed2',
  storageBucket: 'juvia-b0ed2.firebasestorage.app',
  messagingSenderId: '355589046747',
  appId: '1:355589046747:web:222abb18a90a642e4a27fe'
};

if (typeof firebase !== 'undefined') {
  if (!firebase.apps.length) firebase.initializeApp(juviaFirebaseConfig);
  window.juviaFirebaseAuth = firebase.auth();
}