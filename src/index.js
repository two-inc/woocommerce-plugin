import { registerPaymentMethod } from '@woocommerce/blocks-registry';
import { decodeEntities } from '@wordpress/html-entities';
import { getSetting } from '@woocommerce/settings';
import { __ } from '@wordpress/i18n';
import { useState, useEffect, Fragment, useCallback, useRef } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { CART_STORE_KEY } from '@woocommerce/block-data';

const settings = getSetting( 'woocommerce-gateway-tillit_data', {} );

const defaultLabel = __(
    'Two',
    'twoinc-payment-gateway'
);

const title = decodeEntities( settings.title ) || defaultLabel;

const Label = () => {
    return (
        <div style={ { display: 'flex', alignItems: 'center', gap: '0.5em' } }>
            <span
                dangerouslySetInnerHTML={ { __html: settings.icon } }
            />
            <span>{ title }</span>
        </div>
    );
};

const CompanySearch = ({ onSelectCompany }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [companies, setCompanies] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [isCompanySelected, setIsCompanySelected] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [manualCompanyEntry, setManualCompanyEntry] = useState(false);
    const [manualCompanyName, setManualCompanyName] = useState('');
    const [manualCompanyId, setManualCompanyId] = useState('');
    const justSelectedRef = useRef(false);

    // Get billing country from cart data
    const billingCountry = useSelect((select) => {
        const cartStore = select(CART_STORE_KEY);
        const cartData = cartStore?.getCartData?.() || {};
        return cartData?.billingAddress?.country; // Only use user's actual billing country, no fallback
    }, []);

    useEffect(() => {
        if (manualCompanyEntry) {
            onSelectCompany({
                name: manualCompanyName,
                companyId: manualCompanyId,
            });
        }
    }, [manualCompanyEntry, manualCompanyName, manualCompanyId, onSelectCompany]);

    // Set up the twoinc window object for company search
    useEffect(() => {
        if (!window.twoinc) {
            window.twoinc = {
                twoinc_checkout_host: settings.twoincCheckoutHost,
                client_name: settings.clientName,
                client_version: settings.clientVersion,
                merchant: settings.merchant,
            };
        }
    }, []);

    // Search companies function
    const searchCompanies = useCallback(async (term) => {
        if (!term || term.length < 3) {
            setCompanies([]);
            setShowDropdown(false);
            setHighlightedIndex(-1);
            return;
        }

        // Don't search if we don't have a billing country from the user
        if (!billingCountry) {
            setCompanies([]);
            setShowDropdown(false);
            return;
        }

        setIsLoading(true);
        try {
            // Use the current billing country from checkout
            const country = billingCountry.toUpperCase();

            const params = new URLSearchParams({
                q: term,
                country: country,
                limit: 10,
                offset: 0,
                client: settings.clientName,
                client_v: settings.clientVersion,
            });

            const response = await fetch(
                `${settings.twoincCheckoutHost}/companies/v2/company?${params.toString()}`
            );

            if (response.ok) {
                const data = await response.json();
                setCompanies(data.items || []);
                setShowDropdown(true);
                setHighlightedIndex(-1); // Reset highlight when new results come in
            }
        } catch (error) {
            setCompanies([]);
            setHighlightedIndex(-1);
        } finally {
            setIsLoading(false);
        }
    }, [billingCountry]);

    // Debounced search effect - also re-run when billing country changes
    useEffect(() => {
        // Don't search if we just selected a company
        if (justSelectedRef.current) {
            justSelectedRef.current = false;
            return;
        }

        const timer = setTimeout(() => {
            searchCompanies(searchTerm);
        }, 300);

        return () => clearTimeout(timer);
    }, [searchTerm, searchCompanies, billingCountry]);

    const handleCompanySelect = (company) => {
        justSelectedRef.current = true; // Prevent the next debounced search from running
        setSearchTerm(company.name);
        setCompanies([]); // Clear companies array to hide dropdown
        setShowDropdown(false);
        setIsCompanySelected(true); // Track that a company is selected

        // Try to get company ID from various possible field names
        const companyId = company.company_id || company.companyId || company.national_identifier?.id || company.organizationNumber;

        onSelectCompany({
            companyId: companyId,
            name: company.name,
            addressLines: company.addressLines || [],
            postalCode: company.postalCode || '',
            city: company.city || '',
            country: company.country || '',
        });
    };

    const handleInputChange = (e) => {
        setSearchTerm(e.target.value);
        // Reset company selection state when user starts typing again
        if (isCompanySelected) {
            setIsCompanySelected(false);
        }
        setHighlightedIndex(-1); // Reset highlight when typing
    };

    const handleKeyDown = (e) => {
        if (!showDropdown || companies.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex(prev =>
                    prev < companies.length - 1 ? prev + 1 : 0
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex(prev =>
                    prev > 0 ? prev - 1 : companies.length
                );
                break;
            case 'Enter':
                e.preventDefault();
                if (highlightedIndex >= 0 && highlightedIndex < companies.length) {
                    handleCompanySelect(companies[highlightedIndex]);
                } else if (highlightedIndex === companies.length) {
                    setManualCompanyEntry(true);
                    setShowDropdown(false);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setShowDropdown(false);
                setHighlightedIndex(-1);
                break;
        }
    };

    if (manualCompanyEntry) {
        return (
            <div className="form-row form-row-wide" style={{ position: 'relative' }}>
                <p className="form-row form-row-wide">
                    <label htmlFor="twoinc-manual-company-name">
                        {__('Company name', 'twoinc-payment-gateway')}
                        <span className="required">*</span>
                    </label>
                    <input
                        type="text"
                        id="twoinc-manual-company-name"
                        name="twoinc-manual-company-name"
                        value={manualCompanyName}
                        onChange={(e) => setManualCompanyName(e.target.value)}
                        required
                    />
                </p>
                <p className="form-row form-row-wide">
                    <label htmlFor="twoinc-manual-company-id">
                        {__('Company ID', 'twoinc-payment-gateway')}
                        <span className="required">*</span>
                    </label>
                    <input
                        type="text"
                        id="twoinc-manual-company-id"
                        name="twoinc-manual-company-id"
                        value={manualCompanyId}
                        onChange={(e) => setManualCompanyId(e.target.value)}
                        required
                    />
                </p>
                <div
                    id="search_company_btn"
                    onClick={() => {
                        setManualCompanyEntry(false);
                    }}
                >
                    {__('Search for company', 'twoinc-payment-gateway')}
                </div>
            </div>
        )
    }

    return (
        <div className="form-row form-row-wide" style={{ position: 'relative' }}>
            <label htmlFor="twoinc-company-search">
                {__('Company name', 'twoinc-payment-gateway')}
                <span className="required">*</span>
            </label>
            <input
                type="text"
                id="twoinc-company-search"
                name="twoinc-company-search"
                value={searchTerm}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => searchTerm.length >= 3 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                placeholder={__('Start typing company name...', 'twoinc-payment-gateway')}
                autoComplete="organization"
            />
            {isLoading && (
                <div style={{ padding: '8px', fontSize: '12px', color: '#666' }}>
                    {__('Searching...', 'twoinc-payment-gateway')}
                </div>
            )}
            {showDropdown && companies.length > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'white',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        zIndex: 1000,
                    }}
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur when clicking dropdown
                >
                    <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                        {companies.map((company, index) => (
                            <div
                                key={index}
                                style={{
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    borderBottom: index < companies.length - 1 ? '1px solid #eee' : 'none',
                                    backgroundColor: index === highlightedIndex ? '#e6f3ff' : 'white'
                                }}
                                onClick={() => handleCompanySelect(company)}
                                onMouseEnter={(e) => {
                                    e.target.style.backgroundColor = '#f5f5f5';
                                    setHighlightedIndex(index);
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.backgroundColor = index === highlightedIndex ? '#e6f3ff' : 'white';
                                }}
                            >
                                <div style={{ fontWeight: 'bold' }}>{company.name}</div>
                                {company.addressLines && company.addressLines.length > 0 && (
                                    <div style={{ fontSize: '12px', color: '#666' }}>
                                        {company.addressLines.join(', ')}
                                        {company.city && `, ${company.city}`}
                                        {company.postalCode && ` ${company.postalCode}`}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    <div
                        id="company_not_in_btn"
                        className={companies.length === highlightedIndex ? 'highlighted' : ''}
                        key={companies.length}
                        onClick={() => {
                            setManualCompanyEntry(true);
                            setShowDropdown(false);
                        }}
                        onMouseEnter={(e) => {
                            setHighlightedIndex(companies.length);
                        }}
                    >
                        {__('My company is not on the list', 'twoinc-payment-gateway')}
                    </div>
                </div>
            )}
        </div>
    );
};

const TwoincFields = ({ eventRegistration, emitResponse }) => {
    const { onPaymentSetup } = eventRegistration;

    const [companyName, setCompanyName] = useState('');
    const [companyId, setCompanyId] = useState('');
    const [department, setDepartment] = useState('');
    const [project, setProject] = useState('');
    const [purchaseOrderNumber, setPurchaseOrderNumber] = useState('');
    const [invoiceEmail, setInvoiceEmail] = useState('');

    const onSelectCompany = useCallback((company) => {
        setCompanyId(company.companyId);
        setCompanyName(company.name);
    }, []);

    useEffect(() => {
        const unsubscribe = onPaymentSetup(() => {
            if (!companyName) {
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: __('Company name is a required field.', 'twoinc-payment-gateway'),
                };
            }
            if (!companyId) {
                return {
                    type: emitResponse.responseTypes.ERROR,
                    message: __('Company ID is a required field.', 'twoinc-payment-gateway'),
                };
            }

            const paymentMethodData = {
                company_id: companyId,
                company_name: companyName,
                department: department,
                project: project,
                purchase_order_number: purchaseOrderNumber,
                invoice_email: invoiceEmail,
            };

            return {
                type: emitResponse.responseTypes.SUCCESS,
                meta: {
                    paymentMethodData: paymentMethodData,
                },
            };
        });
        return () => {
            unsubscribe();
        };
    }, [
        onPaymentSetup,
        emitResponse,
        companyName,
        companyId,
        department,
        project,
        purchaseOrderNumber,
        invoiceEmail,
    ]);

    return (
        <div className="twoinc-blocks-fields">
            { settings.enableCompanySearch ? (
                <div>
                    <CompanySearch onSelectCompany={onSelectCompany} />
                </div>
            ) : (
                    <Fragment>
                        <p className="form-row form-row-wide">
                            <label htmlFor="twoinc-company-name">
                                {__('Company name', 'twoinc-payment-gateway')}
                                <span className="required">*</span>
                            </label>
                            <input
                                type="text"
                                id="twoinc-company-name"
                                name="twoinc-company-name"
                                value={companyName}
                                onChange={(e) => {
                                    setCompanyName(e.target.value);
                                }}
                                required
                            />
                        </p>
                        <p className="form-row form-row-wide">
                            <label htmlFor="twoinc-company-id">
                                {__('Company registration number', 'twoinc-payment-gateway')}
                                <span className="required">*</span>
                            </label>
                            <input
                                type="text"
                                id="twoinc-company-id"
                                name="twoinc-company-id"
                                value={companyId}
                                onChange={(e) => {
                                    setCompanyId(e.target.value);
                                }}
                                required
                            />
                        </p>
                    </Fragment>
            ) }
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
    ariaLabel: title,
    supports: {
        features: settings.supports,
    },
};

registerPaymentMethod( twoincPaymentMethod );
