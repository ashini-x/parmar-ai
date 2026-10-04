DELETE FROM questions WHERE source = 'SawalNewton DEV SEED';

INSERT INTO questions (
  exam, tier, year, shift, subject, topic, difficulty,
  question_text, option_a, option_b, option_c, option_d,
  correct_option, explanation, source
) VALUES
('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Percentage', 'Easy',
 'A number is increased by 20%. If the original number was 200, what is the new number?',
 '220', '240', '250', '260', 'B',
 '20% of 200 is 40, so the new number is 240.', 'SawalNewton DEV SEED'),

('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Average', 'Easy',
 'What is the average of 10, 20 and 30?',
 '15', '20', '25', '30', 'B',
 'The sum is 60 and 60 divided by 3 is 20.', 'SawalNewton DEV SEED'),

('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Ratio', 'Easy',
 'If the ratio of boys to girls is 2:3 and there are 20 boys, how many girls are there?',
 '25', '30', '35', '40', 'B',
 '2 parts represent 20, so 1 part is 10 and 3 parts are 30.', 'SawalNewton DEV SEED'),

('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Profit and Loss', 'Easy',
 'An article costs 500 and is sold at 10% profit. What is the selling price?',
 '525', '550', '560', '600', 'B',
 '10% of 500 is 50, so the selling price is 550.', 'SawalNewton DEV SEED'),

('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Simple Interest', 'Easy',
 'What is the simple interest on 1000 at 10% per year for 2 years?',
 '100', '150', '200', '250', 'C',
 'SI = P x R x T / 100 = 1000 x 10 x 2 / 100 = 200.', 'SawalNewton DEV SEED'),

('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Time and Work', 'Easy',
 'A worker completes a job in 10 days. What fraction of the job is completed in one day?',
 '1/5', '1/10', '1/15', '1/20', 'B',
 'If the full job takes 10 days, one day completes 1/10 of it.', 'SawalNewton DEV SEED'),

('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Time and Distance', 'Easy',
 'A car travels 120 km in 3 hours. What is its average speed?',
 '30 km/h', '35 km/h', '40 km/h', '45 km/h', 'C',
 'Speed = distance / time = 120 / 3 = 40 km/h.', 'SawalNewton DEV SEED'),

('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Algebra', 'Easy',
 'If x + 7 = 15, what is x?',
 '6', '7', '8', '9', 'C',
 'Subtract 7 from both sides to get x = 8.', 'SawalNewton DEV SEED'),

('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Geometry', 'Easy',
 'What is the sum of the interior angles of a triangle?',
 '90°', '180°', '270°', '360°', 'B',
 'The interior angles of every triangle sum to 180 degrees.', 'SawalNewton DEV SEED'),

('SSC CGL', 'Tier-I', 2024, 'DEV', 'Maths', 'Mensuration', 'Easy',
 'What is the area of a rectangle with length 8 cm and breadth 5 cm?',
 '13 cm²', '26 cm²', '40 cm²', '80 cm²', 'C',
 'Area = length x breadth = 8 x 5 = 40 cm².', 'SawalNewton DEV SEED');
