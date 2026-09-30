import csv
import os
import re

def clean_name(name):
    """Clean variable and form names for REDCap: lowercase, underscores only."""
    if not name:
        return ""
    name = name.strip().lower()
    name = re.sub(r'[^a-z0-9_]', '_', name)
    # Remove leading numbers
    name = re.sub(r'^[0-9]+', '', name)
    # Remove redundant underscores
    name = re.sub(r'_+', '_', name)
    return name.strip('_')

def process_redcap_csvs(input_dir, output_file):
    all_rows = []
    seen_vars = set()
    
    # 1. Define Demographics Form Rows
    demographics_form = "patient_demographics"
    demo_fields = [
        ["record_id", demographics_form, "", "text", "Record ID", "", "", "", "", "", "y", "", "", "", "", "", "", ""],
        ["screening_subject_id", demographics_form, "", "text", "Screening Subject ID", "", "", "", "", "", "y", "", "", "", "", "", "", ""],
        ["age_years", demographics_form, "", "text", "Age in years", "", "", "int", "", "", "", "", "", "", "", "", "", ""],
        ["sex", demographics_form, "", "radio", "Sex", "1, Male | 2, Female | 3, Others", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["marital_status", demographics_form, "", "radio", "Marital status", "1, Single | 2, Married | 3, Others", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["primary_language", demographics_form, "", "radio", "Language", "en, English | kn, Kannada | ta, Tamil | te, Telugu | hi, Hindi | pb, Punjabi", "", "", "", "", "", "", "", "", "", "", "", "@LANGUAGE-SET @LANGUAGE-CURRENT-FORM"],
        ["education_level", demographics_form, "", "dropdown", "Education level", "1, No formal education | 2, Primary (1-5) | 3, Secondary (6-10) | 4, Intermediate (11th/12th/Diploma) | 5, Graduate | 6, Post-graduation/Honors", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["hand_dominance", demographics_form, "", "radio", "Hand dominance", "1, Right | 2, Left", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["occupation_status", demographics_form, "", "radio", "Occupation status", "1, Employed | 2, Unemployed | 3, Retired", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["comorbidities", demographics_form, "", "notes", "Comorbidities", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["pre_walking_status", demographics_form, "", "radio", "Premorbid walking status", "1, Independent with/without gait aid | 2, With assistance | 3, Unable to commute", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["active_hand_movement_onset", demographics_form, "", "radio", "Active hand movement at stroke onset?", "1, Yes | 2, No", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["stroke_severity_nihss", demographics_form, "", "text", "Stroke severity: NIHSS scores", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["time_since_stroke", demographics_form, "", "text", "Time since stroke / Stroke duration (in days) ", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["stroke_type", demographics_form, "", "radio", "Stroke type", "1, Ischemic | 2, Haemorrhagic | 3, Ischemia with haemorrhagic transformation", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["stroke_location", demographics_form, "", "radio", "Stroke location", "1, Cortical | 2, Subcortical", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["hemiparetic_side", demographics_form, "", "radio", "Hemiparetic/hemiplegic side", "1, Right | 2, Left", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["thrombolysis_reperfusion", demographics_form, "", "radio", "Thrombolysis/ reperfusion therapy", "1, Yes | 2, No", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["diagnosis_confirmed_by", demographics_form, "", "radio", "Diagnosis confirmed by", "1, CT | 2, MRI", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["aphasia", demographics_form, "", "radio", "Aphasia", "1, Present | 2, Absent", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]
    
    standard_header = [
        'Variable / Field Name', 'Form Name', 'Section Header', 'Field Type', 
        'Field Label', 'Choices, Calculations, OR Slider Labels', 'Field Note', 
        'Text Validation Type OR Show Slider Number', 'Text Validation Min', 
        'Text Validation Max', 'Identifier?', 'Branching Logic (Show field only if...)', 
        'Required Field?', 'Custom Alignment', 'Question Number (surveys only)', 
        'Matrix Group Name', 'Matrix Ranking?', 'Field Annotation'
    ]

    for field in demo_fields:
        dict_row = dict(zip(standard_header, field))
        
        # Apply mandatory logic to demographics
        var_name = dict_row['Variable / Field Name']
        f_type = dict_row['Field Type']
        is_editable = f_type not in ('descriptive', 'calc')
        is_comment_or_notes = (
            f_type == 'notes' or 
            var_name.endswith('_comm') or 
            var_name.endswith('_comments') or 
            var_name.endswith('_notes') or 
            var_name.endswith('_comment') or
            '_comm_' in var_name or
            '_comment_' in var_name or
            '_comments_' in var_name or
            '_notes_' in var_name
        )
        is_record_id = var_name in ('record_id', 'screening_subject_id', 'subject_id')
        
        if is_editable and not is_comment_or_notes and not is_record_id:
            dict_row['Required Field?'] = 'y'
            
        # Apply locking to demographics too
        locking_tag = "@READONLY-IF([completed_assessment_complete] = '2')"
        if var_name not in ('screening_subject_id', 'record_id'):
            if dict_row['Field Annotation']:
                dict_row['Field Annotation'] = f"{dict_row['Field Annotation'].strip()} {locking_tag}"
            else:
                dict_row['Field Annotation'] = locking_tag
                
        all_rows.append(dict_row)
        seen_vars.add(field[0])

    ORDERED_FILES = [
        "homer_screening_form.csv",
        "consent_form.csv",
        "fma.csv",
        "mas.csv",
        "moca.csv",
        "nprs.csv",
        "completed_screening.csv",
        "arat.csv",
        "box_and_block_test.csv",
        "cahai7.csv",
        "mal.csv",
        "eq5d.csv",
        "mrs.csv",
        "csi.csv",
        "SIPSO.csv",
        "phq9.csv",
        "FSS_vertical.csv",
        "vafs.csv",
        "nihss.csv",
        "completed_assessment.csv",
        "adverse_event.csv",
        "exit_questionnaire_control.csv",
        "exit_questionnaire_intervention.csv",
    ]
    all_files = {f for f in os.listdir(input_dir) if f.endswith('.csv') and f != os.path.basename(output_file) and f != "clean_redcap.py"}
    files = [f for f in ORDERED_FILES if f in all_files]
    # Append any unrecognised files at the end so nothing is silently dropped
    files += sorted(all_files - set(ORDERED_FILES))

    print(f"Found files: {files}")

    for filename in files:
        filepath = os.path.join(input_dir, filename)
        with open(filepath, mode='r', encoding='utf-8-sig') as f:
            raw_reader = csv.reader(f)
            try:
                file_header = next(raw_reader)
            except StopIteration:
                continue
            
            for row in raw_reader:
                if not row or not row[0].strip() or row[0].strip() == 'Variable / Field Name' or row[0].strip().lower() == 'record id':
                    continue

                if len(row) >= 18:
                    var_name = row[0].strip()
                    form_name = row[1].strip()
                    section = row[2]
                    f_type = row[3]
                    label = row[4]
                    choice = row[5]
                    note = row[6]
                    val_type = row[7]
                    val_min = row[8]
                    val_max = row[9]
                    ident = row[10]
                    branch = row[11]
                    req = row[12]
                    align = row[13]
                    q_num = row[14]
                    matrix = row[15]
                    rank = row[16]
                    annot = row[17]
                    
                    merged_choice = choice.strip()
                else:
                    continue

                if var_name.strip().lower() in ('screening_subject_id', 'subject_id', 'homer_id', 'record_id'):
                    continue
                
                if clean_name(form_name) != 'consent_form' and any(re.match(p, var_name.lower()) for p in [r'^[a-z0-9]+_date$', r'^[a-z0-9]+_examiner$']):
                    continue

                cleaned_var = clean_name(var_name)
                if cleaned_var in seen_vars:
                    original_var = cleaned_var
                    counter = 1
                    while cleaned_var in seen_vars:
                        cleaned_var = f"{original_var}_{counter}"
                        counter += 1
                
                seen_vars.add(cleaned_var)
                
                f_type = f_type.lower().strip()
                valid_field_types = ['text', 'notes', 'radio', 'dropdown', 'calc', 'file', 'checkbox', 'yesno', 'truefalse', 'descriptive', 'slider']
                if f_type not in valid_field_types:
                    f_type = 'text' if label else 'descriptive'
                
                if f_type != 'text':
                    val_type = val_min = val_max = ""

                ident = 'y' if ident.lower().strip() == 'y' else ""
                
                # Check if it should be mandatory
                is_editable = f_type not in ('descriptive', 'calc', 'checkbox')
                is_comment_or_notes = (
                    f_type == 'notes' or 
                    cleaned_var.endswith('_comm') or 
                    cleaned_var.endswith('_comments') or 
                    cleaned_var.endswith('_notes') or 
                    cleaned_var.endswith('_comment') or
                    '_comm_' in cleaned_var or
                    '_comment_' in cleaned_var or
                    '_comments_' in cleaned_var or
                    '_notes_' in cleaned_var
                )
                is_record_id = cleaned_var in ('record_id', 'screening_subject_id', 'subject_id')
                is_code_field = cleaned_var.startswith('mal_why_') or '_why_' in cleaned_var or cleaned_var.endswith('_code')
                
                if is_editable and not is_comment_or_notes and not is_record_id and not is_code_field:
                    req = 'y'
                else:
                    req = 'y' if req.lower().strip() == 'y' else ""
                    
                rank = 'y' if rank.lower().strip() == 'y' else ""
                
                valid_alignments = ['LV', 'LH', 'RV', 'RH']
                if align.upper().strip() not in valid_alignments:
                    align = ""
                
                validation_types = ['date_ymd', 'date_mdy', 'date_dmy', 'datetime_ymd', 'datetime_seconds_ymd', 'int', 'float', 'number', 'email', 'phone']
                if any(v in merged_choice for v in validation_types) and f_type == 'text':
                    if not val_type:
                        val_type = merged_choice
                        merged_choice = ""

                # APPLY AUTOMATED LOCKING LOGIC
                # Every field (except record ID and the completion form itself) 
                # will be locked once the assessment or screening is marked 'Complete'
                form_clean = clean_name(form_name)
                screening_only_forms = ('homer_screening_form', 'montreal_cognitive_assessment', 'numeric_pain_rating_scale')
                shared_forms = ('fugl_meyer_assessment_ue', 'modified_ashworth_scale')
                
                if form_clean in screening_only_forms:
                    locking_tag = "@READONLY-IF([completed_screening_complete] = '2')"
                elif form_clean in shared_forms:
                    locking_tag = "@READONLY-IF([completed_assessment_complete] = '2' or [completed_screening_complete] = '2')"
                else:
                    locking_tag = "@READONLY-IF([completed_assessment_complete] = '2')"
                    
                exempt_forms = ('completed_assessment', 'completed_screening', 'adverse_event', 'exit_questionnaire_control', 'exit_questionnaire_intervention', 'fatigue_severity_scale')
                if cleaned_var not in ('screening_subject_id', 'subject_id', 'record_id') and form_clean not in exempt_forms:
                    if annot:
                        if locking_tag not in annot:
                            annot = f"{annot.strip()} {locking_tag}"
                    else:
                        annot = locking_tag

                new_row = {
                    'Variable / Field Name': cleaned_var,
                    'Form Name': clean_name(form_name),
                    'Section Header': section,
                    'Field Type': f_type,
                    'Field Label': label,
                    'Choices, Calculations, OR Slider Labels': merged_choice,
                    'Field Note': note,
                    'Text Validation Type OR Show Slider Number': val_type,
                    'Text Validation Min': val_min,
                    'Text Validation Max': val_max,
                    'Identifier?': ident,
                    'Branching Logic (Show field only if...)': branch,
                    'Required Field?': req,
                    'Custom Alignment': align,
                    'Question Number (surveys only)': q_num,
                    'Matrix Group Name': matrix,
                    'Matrix Ranking?': rank,
                    'Field Annotation': annot
                }
                all_rows.append(new_row)

    os.makedirs(os.path.dirname(output_file), exist_ok=True)

    with open(output_file, mode='w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=standard_header)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"Successfully merged {len(files)} files into {output_file}")
    print(f"Total rows (including Demographics): {len(all_rows)}")

if __name__ == "__main__":
    input_directory = r"e:\homer\homerpdf\redcap"
    output_csv = r"e:\homer\homerpdf\redcap\final\final.csv"
    process_redcap_csvs(input_directory, output_csv)
