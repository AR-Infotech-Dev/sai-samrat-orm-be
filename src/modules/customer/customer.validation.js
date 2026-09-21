export const customerValidationRules = {
  customer_id: { label: "Customer ID", type: "number" },
  name: { label: "Name", required: true },
  email: { label: "Email", type: "email" },
  mobile_no: { label: "Mobile Number" },
  customer_type: { label: "Customer Type" },
  contact_person: { label: "Contact Person" },
  address: { label: "Address" },
  pan_number: { label: "PAN Number" },
  gst_number: { label: "GST Number" },
  created_by: { label: "Created By", type: "number" },
  modified_by: { label: "Modified By", type: "number" },
};
