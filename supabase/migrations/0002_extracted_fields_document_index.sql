create index if not exists extracted_fields_document_idx
  on extracted_fields(tender_document_id)
  where tender_document_id is not null;
