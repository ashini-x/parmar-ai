-- Development-only bilingual helper.
-- Run this AFTER migrations/0001_language_and_translations.sql.
-- It never deletes questions or attempts; it only adds/updates translations
-- for questions whose source is "SawalNewton DEV SEED".

INSERT INTO question_translations (
  question_id,
  language,
  question_text,
  option_a,
  option_b,
  option_c,
  option_d,
  explanation,
  translation_status
)
SELECT
  q.id,
  'hi',
  CASE q.topic
    WHEN 'Percentage' THEN 'एक संख्या में 20% की वृद्धि की जाती है। यदि मूल संख्या 200 थी, तो नई संख्या क्या होगी?'
    WHEN 'Average' THEN '10, 20 और 30 का औसत क्या है?'
    WHEN 'Ratio' THEN 'यदि लड़कों और लड़कियों का अनुपात 2:3 है और लड़कों की संख्या 20 है, तो लड़कियों की संख्या कितनी है?'
    WHEN 'Profit and Loss' THEN 'एक वस्तु का क्रय मूल्य 500 है और उसे 10% लाभ पर बेचा जाता है। विक्रय मूल्य क्या होगा?'
    WHEN 'Simple Interest' THEN '1000 रुपये पर 10% वार्षिक दर से 2 वर्षों का साधारण ब्याज कितना होगा?'
    WHEN 'Time and Work' THEN 'एक मजदूर किसी काम को 10 दिनों में पूरा करता है। वह एक दिन में काम का कितना भाग पूरा करता है?'
    WHEN 'Time and Distance' THEN 'एक कार 3 घंटे में 120 किमी की दूरी तय करती है। उसकी औसत गति क्या है?'
    WHEN 'Algebra' THEN 'यदि x + 7 = 15 है, तो x का मान क्या है?'
    WHEN 'Geometry' THEN 'एक त्रिभुज के आंतरिक कोणों का योग कितना होता है?'
    WHEN 'Mensuration' THEN '8 सेमी लंबाई और 5 सेमी चौड़ाई वाले आयत का क्षेत्रफल कितना है?'
  END,
  q.option_a,
  q.option_b,
  q.option_c,
  q.option_d,
  CASE q.topic
    WHEN 'Percentage' THEN '200 में 20% = 40, इसलिए नई संख्या 240 होगी।'
    WHEN 'Average' THEN 'योग 60 है और 60 को 3 से भाग देने पर 20 मिलता है।'
    WHEN 'Ratio' THEN '2 भाग 20 के बराबर हैं, इसलिए 1 भाग 10 और 3 भाग 30 होंगे।'
    WHEN 'Profit and Loss' THEN '500 का 10% = 50, इसलिए विक्रय मूल्य 550 होगा।'
    WHEN 'Simple Interest' THEN 'SI = P x R x T / 100 = 1000 x 10 x 2 / 100 = 200।'
    WHEN 'Time and Work' THEN 'यदि पूरा काम 10 दिनों में होता है, तो एक दिन में 1/10 काम होगा।'
    WHEN 'Time and Distance' THEN 'गति = दूरी / समय = 120 / 3 = 40 किमी/घंटा।'
    WHEN 'Algebra' THEN 'दोनों तरफ से 7 घटाने पर x = 8 मिलता है।'
    WHEN 'Geometry' THEN 'हर त्रिभुज के आंतरिक कोणों का योग 180° होता है।'
    WHEN 'Mensuration' THEN 'क्षेत्रफल = लंबाई x चौड़ाई = 8 x 5 = 40 सेमी²।'
  END,
  'reviewed'
FROM questions q
WHERE q.source = 'SawalNewton DEV SEED'
ON CONFLICT(question_id, language)
DO UPDATE SET
  question_text = excluded.question_text,
  option_a = excluded.option_a,
  option_b = excluded.option_b,
  option_c = excluded.option_c,
  option_d = excluded.option_d,
  explanation = excluded.explanation,
  translation_status = excluded.translation_status;

INSERT INTO question_translations (
  question_id,
  language,
  question_text,
  option_a,
  option_b,
  option_c,
  option_d,
  explanation,
  translation_status
)
SELECT
  q.id,
  'en',
  q.question_text,
  q.option_a,
  q.option_b,
  q.option_c,
  q.option_d,
  q.explanation,
  'canonical'
FROM questions q
WHERE q.source = 'SawalNewton DEV SEED'
ON CONFLICT(question_id, language)
DO UPDATE SET
  question_text = excluded.question_text,
  option_a = excluded.option_a,
  option_b = excluded.option_b,
  option_c = excluded.option_c,
  option_d = excluded.option_d,
  explanation = excluded.explanation,
  translation_status = excluded.translation_status;
