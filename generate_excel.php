<?php
$rows = [
    ['Customer Name', 'Phone Number', 'Call Time', 'Notes'],
    ['Hawi', '0939777880', 'Immediate', 'Priority Welcome Call'],
    ['Hawi', '0939777880', '12:00 PM', 'Schedule 1 - Account Verification'],
    ['Hawi', '0939777880', '12:15 PM', 'Schedule 2 - Service Update'],
    ['Hawi', '0939777880', '12:30 PM', 'Schedule 3 - Order Confirmation'],
    ['Hawi', '0939777880', '12:45 PM', 'Schedule 4 - Follow-up Notice'],
    ['Hawi', '0939777880', '01:00 PM', 'Schedule 5 - Customer Check-in'],
    ['Hawi', '0939777880', '01:30 PM', 'Schedule 6 - Afternoon Outreach'],
    ['Hawi', '0939777880', '02:00 PM', 'Schedule 7 - Final Reminder']
];

function createXlsx($filename, $rows) {
    $zip = new ZipArchive();
    if ($zip->open($filename, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) return false;

    $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>');

    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>');

    $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>');

    $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Leads" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>');

    $sheetData = '<sheetData>';
    foreach ($rows as $rIdx => $row) {
        $rNum = $rIdx + 1;
        $sheetData .= '<row r="' . $rNum . '">';
        $colLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
        foreach ($row as $cIdx => $val) {
            $cRef = $colLetters[$cIdx] . $rNum;
            $escaped = htmlspecialchars($val, ENT_XML1, 'UTF-8');
            $sheetData .= '<c r="' . $cRef . '" t="inlineStr"><is><t>' . $escaped . '</t></is></c>';
        }
        $sheetData .= '</row>';
    }
    $sheetData .= '</sheetData>';

    $zip->addFromString('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' . $sheetData . '</worksheet>');

    $zip->close();
    return true;
}

createXlsx(__DIR__ . '/sample_leads.xlsx', $rows);
createXlsx(__DIR__ . '/leads_0939777880.xlsx', $rows);
echo "SUCCESS\n";
