import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';
import { __ } from '@wordpress/i18n';
import { useState, useEffect, Fragment } from '@wordpress/element';

const settings = getSetting( 'woocommerce-gateway-tillit_data', {} );

const defaultLabel = __(
    'Two',
    'twoinc-payment-gateway'
);

const Label = ( props ) => {
    const { PaymentMethodLabel } = props.components;
    const title = decodeEntities( settings.title ) || defaultLabel;
    return <PaymentMethodLabel text={ title } />;
};

const TwoincFields = ({ eventRegistration, emitResponse }) => {
    const { onPaymentSetup } = eventRegistration;

    const [companyId, setCompanyId] = useState('');
    const [department, setDepartment] = useState('');
    const [project, setProject] = useState('');
    const [purchaseOrderNumber, setPurchaseOrderNumber] = useState('');
    const [invoiceEmail, setInvoiceEmail] = useState('');

    useEffect(() => {
        const unsubscribe = onPaymentSetup(() => {
            const paymentMethodData = {
                company_id: companyId,
                department: department,
                project: project,
                purchase_order_number: purchaseOrderNumber,
                invoice_email: invoiceEmail,
            };

            // Remove empty values
            Object.keys(paymentMethodData).forEach(key => {
                if (!paymentMethodData[key]) {
                    delete paymentMethodData[key];
                }
            });

            if (Object.keys(paymentMethodData).length > 0) {
                return {
                    type: emitResponse.responseTypes.SUCCESS,
                    meta: {
                        payment_method_data: paymentMethodData,
                    },
                };
            }
            return {
                type: emitResponse.responseTypes.SUCCESS,
            };
        });
        return () => {
            unsubscribe();
        };
    }, [
        onPaymentSetup,
        emitResponse.responseTypes.SUCCESS,
        companyId,
        department,
        project,
        purchaseOrderNumber,
        invoiceEmail,
    ]);

    return (
        <div className="twoinc-blocks-fields">
            <p className="form-row form-row-wide">
                <label htmlFor="twoinc-company-id">{__('Company registration number', 'twoinc-payment-gateway')}</label>
                <input
                    type="text"
                    id="twoinc-company-id"
                    name="twoinc-company-id"
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                />
            </p>
            {settings.addFieldDepartment && (
                <p className="form-row form-row-wide">
                    <label htmlFor="twoinc-department">{__('Department', 'twoinc-payment-gateway')}</label>
                    <input
                        type="text"
                        id="twoinc-department"
                        name="twoinc-department"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                    />
                </p>
            )}
            {settings.addFieldProject && (
                <p className="form-row form-row-wide">
                    <label htmlFor="twoinc-project">{__('Project', 'twoinc-payment-gateway')}</label>
                    <input
                        type="text"
                        id="twoinc-project"
                        name="twoinc-project"
                        value={project}
                        onChange={(e) => setProject(e.target.value)}
                    />
                </p>
            )}
            {settings.addFieldPurchaseOrderNumber && (
                <p className="form-row form-row-wide">
                    <label htmlFor="twoinc-purchase-order-number">{__('Purchase order number', 'twoinc-payment-gateway')}</label>
                    <input
                        type="text"
                        id="twoinc-purchase-order-number"
                        name="twoinc-purchase-order-number"
                        value={purchaseOrderNumber}
                        onChange={(e) => setPurchaseOrderNumber(e.target.value)}
                    />
                </p>
            )}
            {settings.addInvoiceEmail && (
                <p className="form-row form-row-wide">
                    <label htmlFor="twoinc-invoice-email">{__('Invoice email address', 'twoinc-payment-gateway')}</label>
                    <input
                        type="email"
                        id="twoinc-invoice-email"
                        name="twoinc-invoice-email"
                        value={invoiceEmail}
                        onChange={(e) => setInvoiceEmail(e.target.value)}
                    />
                </p>
            )}
        </div>
    );
};

const Content = (props) => {
    return (
        <Fragment>
            <div
                dangerouslySetInnerHTML={{
                    __html: decodeEntities(settings.description || ''),
                }}
            />
            <TwoincFields {...props} />
        </Fragment>
    );
};

const twoincPaymentMethod = {
    name: "woocommerce-gateway-tillit",
    label: <Label />,
    content: <Content />,
    edit: <Content />,
    canMakePayment: () => true,
    ariaLabel: defaultLabel,
    supports: {
        features: settings.supports,
    },
};

registerPaymentMethod( twoincPaymentMethod );
